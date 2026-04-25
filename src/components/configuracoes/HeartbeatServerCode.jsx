import React, { useState } from 'react';
import { Copy, Check, Download, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const HEARTBEAT_CODE = `# heartbeat_server.py — Serviço Heartbeat NOC Monitor
# Corre no Windows Server (ex: 127.0.0.1)
# Cada terminal usa uma porta diferente — escuta cada porta com uma thread dedicada.
#
# Instalacao:
#   pip install requests
#   python heartbeat_server.py
#
# Como Servico Windows (NSSM):
#   nssm install HeartbeatNOC "C:\\Python311\\python.exe" "C:\\Program Files\\HeartbeatNOC\\heartbeat_server.py"
#   nssm set HeartbeatNOC AppDirectory "C:\\Program Files\\HeartbeatNOC"
#   nssm start HeartbeatNOC
#
# Config: C:\\ProgramData\\HeartbeatNOC\\config.json
# {
#   "API_KEY": "a_sua_api_key_pessoal",
#   "APP_ID":  "697aa46c9998c30665e2e19a",
#   "INTERVALO_REPORT": 30
# }
#
# NOTA: O heartbeat_server.py é um servidor STANDALONE dedicado apenas a terminais
# do tipo "Heartbeat TCP". Se já usa o noc_server.py (que inclui Heartbeat + ADMS + SDK),
# NÃO precisa deste servidor separado — evite duplicação de portas TCP.
#
# Como funciona:
#   1. O servico busca terminais do tipo "heartbeat" no NOC Monitor (heartbeatGetTerminals)
#   2. Para cada terminal, abre um socket TCP na porta configurada (o terminal ja aponta para este IP/porta)
#   3. Quando o terminal conecta -> online. Se nao conectar no timeout -> offline
#   4. Reporta o status a cada INTERVALO_REPORT segundos via heartbeatReport

import os, sys, json, time, socket, logging, threading
from logging.handlers import RotatingFileHandler
import requests

# ──────────────────────────────────────────────────────────────
# Constantes
# ──────────────────────────────────────────────────────────────
PROGRAMDATA    = os.environ.get("PROGRAMDATA", r"C:\\ProgramData")
APP_DIR        = os.path.join(PROGRAMDATA, "HeartbeatNOC")
CONFIG_FILE    = os.path.join(APP_DIR, "config.json")
LOG_FILE       = os.path.join(APP_DIR, "heartbeat.log")
LOCK_FILE      = os.path.join(APP_DIR, "heartbeat.lock")

DEFAULT_INTERVAL = 30       # segundos entre ciclos de reporte
ACCEPT_TIMEOUT   = 25       # segundos que aguarda o terminal conectar por ciclo
BASE_URL = "https://app.base44.app/api/apps/{app_id}/functions"

logger   = logging.getLogger("heartbeat_noc")
hb_state = {}   # { terminal_id: { "connected": bool, "last_seen": float, "latencia_ms": int|None } }
hb_lock  = threading.Lock()


# ──────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────
def setup_logging(level=logging.INFO):
    os.makedirs(APP_DIR, exist_ok=True)
    h   = RotatingFileHandler(LOG_FILE, maxBytes=2_000_000, backupCount=5, encoding="utf-8")
    fmt = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s", "%Y-%m-%d %H:%M:%S")
    logger.handlers.clear()
    h.setFormatter(fmt)
    logger.addHandler(h)
    logger.setLevel(level)
    if sys.stdout.isatty() or sys.stderr.isatty():
        sh = logging.StreamHandler()
        sh.setFormatter(fmt)
        logger.addHandler(sh)


# ──────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────
def load_config():
    api_key  = os.environ.get("BASE44_API_KEY", "").strip()
    app_id   = os.environ.get("BASE44_APP_ID", "").strip()
    interval = int(os.environ.get("HB_INTERVAL", "0"))
    if api_key and app_id and len(api_key) >= 16:
        return {"API_KEY": api_key, "APP_ID": app_id, "INTERVALO_REPORT": interval or DEFAULT_INTERVAL}

    if os.path.exists(CONFIG_FILE):
        try:
            cfg     = json.load(open(CONFIG_FILE, encoding="utf-8"))
            api_key = (cfg.get("API_KEY") or "").strip()
            app_id  = (cfg.get("APP_ID")  or "").strip()
            if api_key and app_id and len(api_key) >= 16:
                return {
                    "API_KEY": api_key,
                    "APP_ID": app_id,
                    "INTERVALO_REPORT": cfg.get("INTERVALO_REPORT", DEFAULT_INTERVAL),
                }
            logger.error("config.json invalido: API_KEY ou APP_ID ausentes.")
        except Exception as e:
            logger.error(f"Falha ao ler config.json: {e}")
    return None


# ──────────────────────────────────────────────────────────────
# Instancia unica
# ──────────────────────────────────────────────────────────────
class SingleInstance:
    def __init__(self, path):
        self.path = path; self.fp = None
    def acquire(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self.fp = open(self.path, "a+")
        try:
            import msvcrt
            msvcrt.locking(self.fp.fileno(), msvcrt.LK_NBLCK, 1)
            self.fp.seek(0); self.fp.truncate()
            self.fp.write(str(os.getpid())); self.fp.flush()
            return True
        except Exception:
            if self.fp: self.fp.close(); self.fp = None
            return False
    def release(self):
        try:
            if self.fp:
                import msvcrt
                self.fp.seek(0); self.fp.truncate()
                msvcrt.locking(self.fp.fileno(), msvcrt.LK_UNLCK, 1)
                self.fp.close()
        except Exception:
            pass


# ──────────────────────────────────────────────────────────────
# API
# ──────────────────────────────────────────────────────────────
def _headers(api_key):
    return {"X-Api-Key": api_key, "Content-Type": "application/json"}


def listar_terminais(session, app_id, api_key):
    url = f"{BASE_URL.format(app_id=app_id)}/nocServerGetTerminals"
    r   = session.post(url, headers=_headers(api_key), json={}, timeout=10)
    r.raise_for_status()
    data = r.json()
    if not data.get("success"):
        raise ValueError(f"nocServerGetTerminals erro: {data}")
    # Filtrar apenas terminais do tipo heartbeat
    todos = data.get("terminals", [])
    return [t for t in todos if t.get("tipo_conexao") == "heartbeat"]


def reportar_status(session, app_id, api_key, terminal_id, status, latencia_ms=None, segundos_sem_ping=0):
    url     = f"{BASE_URL.format(app_id=app_id)}/nocServerReport"
    payload = {
        "terminal_id":       terminal_id,
        "status":            status,
        "latencia_ms":       latencia_ms,
        "segundos_sem_ping": segundos_sem_ping,
    }
    r = session.post(url, headers=_headers(api_key), json=payload, timeout=10)
    r.raise_for_status()
    return r.json()


# ──────────────────────────────────────────────────────────────
# Listener por porta — thread dedicada por terminal
# ──────────────────────────────────────────────────────────────
def listener_thread(terminal, stop_event):
    """
    Abre um socket TCP servidor na porta configurada e aceita conexoes.
    Cada vez que o terminal (cliente) conecta -> marca connected=True.
    Se passa ACCEPT_TIMEOUT sem conexao -> marca connected=False (offline).
    """
    tid   = terminal["id"]
    nome  = terminal.get("nome", tid)
    porta = int(terminal.get("porta", 5005))

    logger.info(f"[LISTENER] Iniciando escuta para '{nome}' na porta :{porta}")

    with hb_lock:
        if tid not in hb_state:
            hb_state[tid] = {"connected": False, "last_seen": 0, "latencia_ms": None}

    srv_sock = None
    while not stop_event.is_set():
        try:
            if srv_sock is None:
                srv_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                srv_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                srv_sock.bind(("0.0.0.0", porta))
                srv_sock.listen(5)
                srv_sock.settimeout(ACCEPT_TIMEOUT)
                logger.info(f"[LISTENER] '{nome}' aguardando conexao na :{porta}")

            try:
                t0 = time.time()
                conn, addr = srv_sock.accept()
                latencia   = int((time.time() - t0) * 1000)
                conn.close()  # Heartbeat — apenas aceitar e fechar
                with hb_lock:
                    hb_state[tid] = {
                        "connected":   True,
                        "last_seen":   time.time(),
                        "latencia_ms": latencia,
                    }
                logger.info(f"[HB] '{nome}' :{porta} <- {addr[0]} ONLINE (lat={latencia}ms)")

            except socket.timeout:
                # Sem conexao no timeout -> offline
                with hb_lock:
                    hb_state[tid]["connected"] = False
                logger.debug(f"[HB] '{nome}' :{porta} timeout (OFFLINE)")

        except OSError as e:
            logger.error(f"[LISTENER] Erro socket '{nome}' :{porta} — {e}")
            if srv_sock:
                try: srv_sock.close()
                except: pass
                srv_sock = None
            for _ in range(5):
                if stop_event.is_set(): break
                time.sleep(1)

    if srv_sock:
        try: srv_sock.close()
        except: pass
    logger.info(f"[LISTENER] Thread '{nome}' :{porta} encerrada.")


# ──────────────────────────────────────────────────────────────
# Ciclo de reporte
# ──────────────────────────────────────────────────────────────
def ciclo_reporte(terminais, app_id, api_key, stop_event, intervalo):
    logger.info(f"[REPORT] Ciclo de reporte — intervalo={intervalo}s")

    while not stop_event.is_set():
        sess = requests.Session()
        try:
            for t in terminais:
                if stop_event.is_set(): break
                tid  = t["id"]
                nome = t.get("nome", tid)

                with hb_lock:
                    estado = hb_state.get(tid, {})

                connected  = estado.get("connected", False)
                last_seen  = estado.get("last_seen", 0)
                latencia   = estado.get("latencia_ms")
                seg_offline = int(time.time() - last_seen) if not connected and last_seen > 0 else 0

                status = "online" if connected else "offline"

                try:
                    reportar_status(sess, app_id, api_key,
                                    terminal_id=tid,
                                    status=status,
                                    latencia_ms=latencia,
                                    segundos_sem_ping=seg_offline)
                    logger.info(f"[REPORT] '{nome}' -> {status.upper()}"
                                + (f" lat={latencia}ms" if latencia else "")
                                + (f" offline={seg_offline}s" if seg_offline else ""))
                except requests.HTTPError as e:
                    code = e.response.status_code if e.response is not None else "?"
                    logger.error(f"[REPORT] HTTP {code} ao reportar '{nome}'")
                except Exception as e:
                    logger.error(f"[REPORT] Erro '{nome}': {e}")
        finally:
            sess.close()

        for _ in range(intervalo):
            if stop_event.is_set(): return
            time.sleep(1)


# ──────────────────────────────────────────────────────────────
# Orquestrador Principal
# ──────────────────────────────────────────────────────────────
def run_heartbeat_server(stop_event=None):
    if stop_event is None:
        stop_event = threading.Event()

    os.makedirs(APP_DIR, exist_ok=True)
    lock = SingleInstance(LOCK_FILE)
    if not lock.acquire():
        logger.error("Outra instancia ja esta a correr. Encerrando.")
        return 2

    try:
        config = None
        while not stop_event.is_set():
            config = load_config()
            if config: break
            logger.warning("config.json ausente/invalido. A aguardar 10s...")
            for _ in range(10):
                if stop_event.is_set(): return 0
                time.sleep(1)

        if not config or stop_event.is_set():
            return 0

        app_id    = config["APP_ID"]
        api_key   = config["API_KEY"]
        intervalo = config["INTERVALO_REPORT"]

        logger.info("A obter lista de terminais do NOC Monitor...")
        sess = requests.Session()
        terminais = []
        while not stop_event.is_set():
            try:
                terminais = listar_terminais(sess, app_id, api_key)
                break
            except Exception as e:
                logger.error(f"Nao foi possivel obter terminais: {e}. A tentar em 15s...")
                for _ in range(15):
                    if stop_event.is_set(): return 0
                    time.sleep(1)
        sess.close()

        if not terminais:
            logger.warning("Nenhum terminal 'heartbeat' encontrado. Adicione terminais no painel NOC Monitor.")
            return 0

        logger.info(f"Terminais a monitorizar: {len(terminais)}")
        for t in terminais:
            logger.info(f"  * {t['nome']} — porta :{t['porta']}")

        # Uma thread de escuta por terminal/porta
        for t in terminais:
            th = threading.Thread(
                target=listener_thread,
                args=(t, stop_event),
                name=f"hb-{t['nome']}-{t['porta']}",
                daemon=True,
            )
            th.start()

        # Loop de reporte (bloqueia aqui)
        ciclo_reporte(terminais, app_id, api_key, stop_event, intervalo)
        return 0

    except KeyboardInterrupt:
        logger.info("Interrompido.")
        stop_event.set()
        return 0
    finally:
        lock.release()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="NOC Monitor — Heartbeat Server")
    parser.add_argument("--interval", type=int, default=0, help="Intervalo de reporte em segundos")
    parser.add_argument("--debug", action="store_true", help="Logging detalhado")
    args = parser.parse_args()

    setup_logging(logging.DEBUG if args.debug else logging.INFO)
    logger.info("=" * 60)
    logger.info("  NOC Monitor — Heartbeat Server")
    logger.info("=" * 60)

    if args.interval:
        os.environ["HB_INTERVAL"] = str(args.interval)

    sys.exit(run_heartbeat_server())
`;

export default function HeartbeatServerCode() {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(HEARTBEAT_CODE);
    setCopied(true);
    toast.success('Código copiado!');
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownload = () => {
    const blob = new Blob([HEARTBEAT_CODE], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'heartbeat_server.py';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('heartbeat_server.py descarregado!');
  };

  return (
    <div className="space-y-3">
      {/* Descrição do modo */}
      <div className="p-4 bg-violet-50 border border-violet-200 rounded-xl space-y-2 text-sm">
        <p className="font-semibold text-violet-800 flex items-center gap-2">
          <Radio className="h-4 w-4" />
          Modo Heartbeat — Windows Server com IP Público
        </p>
        <div className="text-violet-700 space-y-1 text-xs">
          <p>✅ <strong>Ideal para:</strong> terminais já apontados ao servidor Windows (<code className="bg-violet-100 px-1 rounded">127.0.0.1</code>) com portas diferentes</p>
          <p>🔌 <strong>Como funciona:</strong> o serviço abre um socket TCP em cada porta configurada → o terminal conecta → online. Se não conectar no timeout → offline.</p>
          <p>📡 <strong>Uma porta por terminal</strong> — as portas já abertas no firewall do servidor são usadas diretamente</p>
          <p>📊 <strong>Reporte automático</strong> ao painel NOC Monitor a cada ciclo (default 30s)</p>
        </div>
      </div>

      {/* Config */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono space-y-1">
        <p className="text-slate-500 text-xs font-sans font-semibold mb-2">📄 C:\ProgramData\HeartbeatNOC\config.json</p>
        <p className="text-slate-700">{`{`}</p>
        <p className="text-slate-700 pl-4">{`"API_KEY": "a_sua_api_key_pessoal",`}</p>
        <p className="text-slate-700 pl-4">{`"APP_ID":  "697aa46c9998c30665e2e19a",`}</p>
        <p className="text-slate-700 pl-4">{`"INTERVALO_REPORT": 30`}</p>
        <p className="text-slate-700">{`}`}</p>
      </div>

      {/* Passos */}
      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 space-y-1">
        <p className="font-semibold">⚡ Passos de instalação no Windows Server</p>
        <p>1. Instalar Python 3.9+ e <code className="bg-emerald-100 px-1 rounded">pip install requests</code></p>
        <p>2. Copiar <code className="bg-emerald-100 px-1 rounded">heartbeat_server.py</code> para <code className="bg-emerald-100 px-1 rounded">C:\Program Files\HeartbeatNOC\</code></p>
        <p>3. Criar <code className="bg-emerald-100 px-1 rounded">C:\ProgramData\HeartbeatNOC\config.json</code> com a API Key</p>
        <p>4. Adicionar terminais no painel com tipo <strong>Heartbeat</strong> e a porta de cada terminal</p>
        <p>5. Instalar como serviço Windows via NSSM:</p>
        <code className="bg-emerald-100 px-2 py-1 rounded block mt-1">
          nssm install HeartbeatNOC "C:\Python311\python.exe" "C:\Program Files\HeartbeatNOC\heartbeat_server.py"
        </code>
      </div>

      {/* Botões */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold text-slate-700">📥 heartbeat_server.py</p>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setExpanded(v => !v)}>
            {expanded ? 'Ocultar' : 'Ver código'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4" />
            Download
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copiado!' : 'Copiar'}
          </Button>
        </div>
      </div>

      {expanded && (
        <pre className="bg-slate-900 text-violet-300 p-4 rounded-lg text-xs overflow-x-auto max-h-[500px] overflow-y-auto font-mono leading-relaxed whitespace-pre">
          {HEARTBEAT_CODE}
        </pre>
      )}
    </div>
  );
}