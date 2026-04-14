import React, { useState } from 'react';
import { Copy, Check, Download, Server, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

const P2S_SERVER_CODE = `# p2s_server.py — Servidor P2S (Push to Server) para Terminais Biométricos
# Versão: 2.0  |  IP Servidor: 51.91.219.145
#
# O que é modo P2S / Push to Server?
#   No modo P2S, o terminal biométrico NÃO espera que o servidor tente conectar-se a ele.
#   Em vez disso, é o próprio terminal que INICIA a conexão TCP ao servidor.
#   Isto é essencial quando o terminal está numa rede privada/NAT sem IP acessível externamente.
#
# Compatibilidade confirmada:
#   - ZKTeco (SDK ZKAccess/ZKLibrary): usa função SetServerPortAndTick(porta, 7)
#     Modelos: F22, MB20, MA300, SpeedFace, ProBio, InFaceX, SilkBio, K20, SC700
#   - Anviz (modo "Server Mode"): conecta TCP na porta configurada
#     Modelos: C2 Pro, W2 Pro, EP10, A5, D3, B37, CrossChex
#   - Suprema (modo "Server Connection"): porta configurável
#     Modelos: BioStation 2, BioStation A2, FaceStation 2, BioEntry W2
#   - Hikvision/Dahua: modo "Platform Connection" ou "Active Registration"
#   - Nitgen (modo "Server" / WireFinger SDK)
#   - Terminals Genéricos: qualquer terminal com suporte a TCP Push/Inverso
#
# Como funciona:
#   1. Este servidor fica a ESCUTAR uma porta TCP (uma por terminal ou partilhada)
#   2. O terminal está configurado para conectar ao IP do servidor nessa porta
#   3. Quando recebe conexão → terminal está ONLINE; sem conexão em timeout → OFFLINE
#   4. O servidor reporta o status ao NOC Monitor via API
#
# Configuração no terminal ZKTeco (via ZKAccess Software ou SDK):
#   SetServerPortAndTick(5100, 7)   ← porta 5100, keepalive 7s
#   O terminal tentará conectar a 51.91.219.145:5100 continuamente
#
# Configuração no terminal Anviz (via Web UI / CrossChex):
#   Server IP: 51.91.219.145
#   Server Port: 5200 (configurar porta diferente para cada terminal)
#   Connection Mode: Server (TCP Push)
#
# Config: C:\\ProgramData\\P2SServer\\config.json
# {
#   "API_KEY":          "a_sua_api_key_pessoal",
#   "APP_ID":           "697aa46c9998c30665e2e19a",
#   "INTERVALO_REPORT": 20,
#   "KEEPALIVE_TIMEOUT": 60,
#   "STATUS_PORT":      9100
# }
#
# Como Serviço Windows (NSSM):
#   nssm install P2SServer "C:\\Python311\\python.exe" "C:\\Program Files\\P2SServer\\p2s_server.py"
#   nssm set P2SServer AppDirectory "C:\\Program Files\\P2SServer"
#   nssm start P2SServer
#
# Portas a abrir no Firewall do Windows (Regras de Entrada, TCP):
#   - Portas configuradas para cada terminal P2S (ex: 5100, 5101, 5102...)
#   - Porta STATUS_PORT (default 9100): interface de diagnóstico HTTP

import os, sys, json, time, socket, logging, threading
from logging.handlers import RotatingFileHandler
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
import requests

# ──────────────────────────────────────────────────────────────
# Paths e Constantes
# ──────────────────────────────────────────────────────────────
PROGRAMDATA    = os.environ.get("PROGRAMDATA", r"C:\\ProgramData")
APP_DIR        = os.path.join(PROGRAMDATA, "P2SServer")
CONFIG_FILE    = os.path.join(APP_DIR, "config.json")
LOG_FILE       = os.path.join(APP_DIR, "p2s_server.log")
LOCK_FILE      = os.path.join(APP_DIR, "p2s_server.lock")

DEFAULT_INTERVAL   = 20    # segundos entre ciclos de reporte
DEFAULT_KEEPALIVE  = 60    # segundos — conexão sem actividade = OFFLINE
DEFAULT_STATUS_PORT = 9100 # porta HTTP de diagnóstico

BASE_URL = "https://app.base44.app/api/apps/{app_id}/functions"

logger    = logging.getLogger("p2s_server")

# Estado em memória: { terminal_id → { "connected": bool, "last_seen": float, "addr": str, "conn_count": int } }
state      = {}
state_lock = threading.Lock()

# Sockets ativos por terminal (para cleanup): { terminal_id → server_socket }
active_sockets = {}
sockets_lock   = threading.Lock()


# ──────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────
def setup_logging(level=logging.INFO):
    os.makedirs(APP_DIR, exist_ok=True)
    h   = RotatingFileHandler(LOG_FILE, maxBytes=5_000_000, backupCount=5, encoding="utf-8")
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
# Instância Única (lock de processo)
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
# Carregar Configuração
# ──────────────────────────────────────────────────────────────
def load_config():
    api_key    = os.environ.get("BASE44_API_KEY", "").strip()
    app_id     = os.environ.get("BASE44_APP_ID",  "").strip()
    interval   = int(os.environ.get("P2S_INTERVAL", "0"))
    keepalive  = int(os.environ.get("P2S_KEEPALIVE", "0"))
    status_port = int(os.environ.get("P2S_STATUS_PORT", "0"))
    if api_key and app_id and len(api_key) >= 16:
        return {"API_KEY": api_key, "APP_ID": app_id,
                "INTERVALO_REPORT": interval or DEFAULT_INTERVAL,
                "KEEPALIVE_TIMEOUT": keepalive or DEFAULT_KEEPALIVE,
                "STATUS_PORT": status_port or DEFAULT_STATUS_PORT}
    if os.path.exists(CONFIG_FILE):
        try:
            cfg = json.load(open(CONFIG_FILE, encoding="utf-8"))
            api_key = (cfg.get("API_KEY") or "").strip()
            app_id  = (cfg.get("APP_ID")  or "").strip()
            if api_key and app_id and len(api_key) >= 16:
                return {
                    "API_KEY": api_key,
                    "APP_ID": app_id,
                    "INTERVALO_REPORT":  cfg.get("INTERVALO_REPORT",  DEFAULT_INTERVAL),
                    "KEEPALIVE_TIMEOUT": cfg.get("KEEPALIVE_TIMEOUT", DEFAULT_KEEPALIVE),
                    "STATUS_PORT":       cfg.get("STATUS_PORT",       DEFAULT_STATUS_PORT),
                }
            logger.error("config.json: API_KEY ou APP_ID inválidos/ausentes.")
        except Exception as e:
            logger.error(f"Falha ao ler config.json: {e}")
    return None


# ──────────────────────────────────────────────────────────────
# API Helpers
# ──────────────────────────────────────────────────────────────
def _headers(api_key):
    return {"X-Api-Key": api_key, "Content-Type": "application/json"}

def listar_terminais(session, app_id, api_key):
    """Obtém lista de terminais P2S do NOC Monitor."""
    url = f"{BASE_URL.format(app_id=app_id)}/p2sGetTerminals"
    r   = session.post(url, headers=_headers(api_key), json={}, timeout=10)
    r.raise_for_status()
    data = r.json()
    if not data.get("success"):
        raise ValueError(f"p2sGetTerminals erro: {data}")
    return data.get("terminals", [])

def reportar_status(session, app_id, api_key, terminal_id, status, addr=None, conn_count=0):
    """Reporta status de um terminal P2S ao NOC Monitor."""
    url = f"{BASE_URL.format(app_id=app_id)}/p2sReport"
    payload = {
        "terminal_id": terminal_id,
        "status":      status,
        "addr":        addr or "",
        "conn_count":  conn_count,
    }
    r = session.post(url, headers=_headers(api_key), json=payload, timeout=10)
    r.raise_for_status()
    return r.json()


# ──────────────────────────────────────────────────────────────
# Listener P2S — uma thread por terminal
#
# O terminal CONECTA ao servidor nesta porta.
# Compatível com:
#   - ZKTeco SetServerPortAndTick(porta, keepalive)
#   - Anviz Server Mode (TCP Push)
#   - Suprema Server Connection
#   - Hikvision/Dahua Active Registration (TCP)
# ──────────────────────────────────────────────────────────────
def _handle_connection(conn, addr, tid, nome, keepalive_timeout):
    """
    Gere uma conexão TCP ativa do terminal.
    Mantém socket aberto lendo dados (keepalive packets).
    Quando o terminal desconecta ou timeout → estado muda para offline.
    """
    conn.settimeout(keepalive_timeout)
    ip_str = f"{addr[0]}:{addr[1]}"

    with state_lock:
        s = state.get(tid, {})
        s["connected"]  = True
        s["last_seen"]  = time.time()
        s["addr"]       = ip_str
        s["conn_count"] = s.get("conn_count", 0) + 1
        state[tid] = s

    logger.info(f"[P2S] ✅ '{nome}' CONECTOU de {ip_str} (total={state[tid]['conn_count']})")

    try:
        while True:
            data = conn.recv(512)
            if not data:
                # Terminal fechou a conexão graciosamente
                break
            # Manter o estado "online" a cada pacote recebido
            with state_lock:
                state[tid]["last_seen"] = time.time()
            logger.debug(f"[P2S] '{nome}' data ({len(data)}B): {data[:32].hex()}...")
            # Enviar ACK se necessário (alguns terminais esperam resposta)
            # ZKTeco: enviar "OK\\n" ou "000 OK\\n"
            # Anviz/Suprema: silêncio é ok
            conn.sendall(b"OK\\n")
    except socket.timeout:
        logger.info(f"[P2S] '{nome}' timeout ({keepalive_timeout}s) → OFFLINE")
    except (ConnectionResetError, OSError) as e:
        logger.info(f"[P2S] '{nome}' conexão encerrada: {e}")
    finally:
        conn.close()
        with state_lock:
            if tid in state:
                state[tid]["connected"] = False
        logger.info(f"[P2S] ❌ '{nome}' DESCONECTOU de {ip_str}")


def p2s_listener(terminal, stop_event, keepalive_timeout):
    """
    Thread dedicada a um terminal P2S.
    Escuta na porta configurada e gere múltiplas conexões sequenciais.
    O terminal ZKTeco reconectará automaticamente quando possível.
    """
    tid   = terminal["id"]
    nome  = terminal.get("nome", tid)
    porta = int(terminal.get("porta") or 5100)

    with state_lock:
        state[tid] = {"connected": False, "last_seen": 0, "addr": None, "conn_count": 0}

    logger.info(f"[P2S] Iniciando escuta P2S para '{nome}' em 0.0.0.0:{porta}")
    srv_sock = None

    while not stop_event.is_set():
        try:
            if srv_sock is None:
                srv_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                srv_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                # TCP keepalive do SO (deteta terminais silenciosos)
                srv_sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
                srv_sock.bind(("0.0.0.0", porta))
                srv_sock.listen(5)
                srv_sock.settimeout(3)  # timeout para accept — para verificar stop_event

                with sockets_lock:
                    active_sockets[tid] = srv_sock

            try:
                conn, addr = srv_sock.accept()
                # Lançar thread para gerir a conexão individual
                t = threading.Thread(
                    target=_handle_connection,
                    args=(conn, addr, tid, nome, keepalive_timeout),
                    daemon=True
                )
                t.start()
            except socket.timeout:
                # Verificar se o terminal que estava online ainda está (timeout de keepalive)
                with state_lock:
                    s = state.get(tid, {})
                    if s.get("connected") and s.get("last_seen"):
                        elapsed = time.time() - s["last_seen"]
                        if elapsed > keepalive_timeout:
                            state[tid]["connected"] = False
                            logger.info(f"[P2S] '{nome}' timeout de keepalive ({elapsed:.0f}s) → OFFLINE")

        except OSError as e:
            logger.error(f"[P2S] Erro socket '{nome}' :{porta} — {e}")
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
    with sockets_lock:
        active_sockets.pop(tid, None)
    logger.info(f"[P2S] Thread '{nome}' :{porta} encerrada.")


# ──────────────────────────────────────────────────────────────
# Ciclo de Reporte → NOC Monitor
# ──────────────────────────────────────────────────────────────
def ciclo_reporte(terminais, app_id, api_key, stop_event, intervalo):
    logger.info(f"[REPORT] Ciclo activo — intervalo={intervalo}s | {len(terminais)} terminal(is)")

    while not stop_event.is_set():
        sess = requests.Session()
        try:
            for t in terminais:
                if stop_event.is_set(): break
                tid  = t["id"]
                nome = t.get("nome", tid)

                with state_lock:
                    s = state.get(tid, {})
                connected  = s.get("connected", False)
                addr       = s.get("addr", "")
                conn_count = s.get("conn_count", 0)
                status     = "online" if connected else "offline"

                try:
                    reportar_status(sess, app_id, api_key,
                                    terminal_id=tid,
                                    status=status,
                                    addr=addr,
                                    conn_count=conn_count)
                    logger.info(f"[REPORT] '{nome}' P2S → {status.upper()}"
                                + (f" ({addr})" if addr and connected else "")
                                + f" | conexões={conn_count}")
                except requests.HTTPError as e:
                    code = e.response.status_code if e.response is not None else "?"
                    logger.error(f"[REPORT] HTTP {code} ao reportar '{nome}'")
                except Exception as e:
                    logger.error(f"[REPORT] Erro ao reportar '{nome}': {e}")
        finally:
            sess.close()

        for _ in range(intervalo):
            if stop_event.is_set(): return
            time.sleep(1)


# ──────────────────────────────────────────────────────────────
# Interface de Diagnóstico HTTP (porta STATUS_PORT)
# GET /status  → estado atual de todos os terminais
# GET /health  → OK se o servidor está operacional
# ──────────────────────────────────────────────────────────────
class StatusHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.path in ("/status", "/status/"):
            with state_lock:
                data = {tid: {k: v for k, v in s.items()} for tid, s in state.items()}
            # Calcular segundos offline para cada terminal
            agora = time.time()
            for tid, s in data.items():
                if not s.get("connected") and s.get("last_seen") and s["last_seen"] > 0:
                    s["seconds_offline"] = int(agora - s["last_seen"])
                else:
                    s["seconds_offline"] = 0
            body = json.dumps({"p2s_server": "running", "terminals": data, "timestamp": agora}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", len(body))
            self.end_headers()
            self.wfile.write(body)

        elif self.path == "/health":
            body = b"OK"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", len(body))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()


def start_status_server(port, stop_event):
    try:
        server = HTTPServer(("0.0.0.0", port), StatusHandler)
        server.timeout = 1
        logger.info(f"[STATUS] Interface de diagnóstico em http://51.91.219.145:{port}/status")
        while not stop_event.is_set():
            server.handle_request()
        server.server_close()
    except Exception as e:
        logger.error(f"[STATUS] Erro no servidor HTTP: {e}")


# ──────────────────────────────────────────────────────────────
# Orquestrador Principal
# ──────────────────────────────────────────────────────────────
def run_p2s_server(stop_event=None):
    if stop_event is None:
        stop_event = threading.Event()

    os.makedirs(APP_DIR, exist_ok=True)
    lock = SingleInstance(LOCK_FILE)
    if not lock.acquire():
        logger.error("Outra instância já está a correr. Encerrando.")
        return 2

    try:
        config = None
        while not stop_event.is_set():
            config = load_config()
            if config: break
            logger.warning("config.json ausente/inválido. A aguardar 10s...")
            for _ in range(10):
                if stop_event.is_set(): return 0
                time.sleep(1)

        if not config or stop_event.is_set():
            return 0

        app_id          = config["APP_ID"]
        api_key         = config["API_KEY"]
        intervalo       = config.get("INTERVALO_REPORT",  DEFAULT_INTERVAL)
        keepalive       = config.get("KEEPALIVE_TIMEOUT", DEFAULT_KEEPALIVE)
        status_port     = config.get("STATUS_PORT",       DEFAULT_STATUS_PORT)

        logger.info("=" * 65)
        logger.info("  P2S Server — Servidor Push to Server / Conexão Inversa")
        logger.info(f"  IP Servidor: 51.91.219.145")
        logger.info(f"  Keepalive timeout: {keepalive}s")
        logger.info(f"  Diagnóstico HTTP: :{status_port}/status")
        logger.info(f"  Compatível com: ZKTeco, Anviz, Suprema, Hikvision, Dahua, Nitgen")
        logger.info("=" * 65)

        # Obter lista de terminais P2S
        sess = requests.Session()
        terminais = []
        while not stop_event.is_set():
            try:
                terminais = listar_terminais(sess, app_id, api_key)
                break
            except Exception as e:
                logger.error(f"Não foi possível obter terminais: {e}. A tentar em 15s...")
                for _ in range(15):
                    if stop_event.is_set(): return 0
                    time.sleep(1)
        sess.close()

        if not terminais:
            logger.warning("Nenhum terminal P2S encontrado. Adicione terminais com tipo=p2s no painel.")
            # Continuar a escutar — terminais podem ser adicionados depois
            terminais = []

        logger.info(f"Terminais P2S carregados: {len(terminais)}")
        for t in terminais:
            logger.info(f"  - '{t['nome']}' | porta :{t.get('porta', 5100)} | "
                        f"fabricante: {t.get('fabricante', 'desconhecido')}")

        # Iniciar interface de diagnóstico HTTP
        status_thread = threading.Thread(
            target=start_status_server,
            args=(status_port, stop_event),
            name="status-http",
            daemon=True
        )
        status_thread.start()

        # Iniciar uma thread listener por terminal
        for t in terminais:
            th = threading.Thread(
                target=p2s_listener,
                args=(t, stop_event, keepalive),
                name=f"p2s-{t['nome']}-:{t.get('porta', 5100)}",
                daemon=True
            )
            th.start()
            logger.info(f"  [P2S] Listener iniciado para '{t['nome']}' em :{t.get('porta', 5100)}")

        # Ciclo de reporte (bloqueia aqui)
        ciclo_reporte(terminais, app_id, api_key, stop_event, intervalo)
        return 0

    except KeyboardInterrupt:
        logger.info("Interrompido pelo utilizador.")
        stop_event.set()
        return 0
    finally:
        lock.release()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="P2S Server — Servidor Push to Server para Terminais Biométricos")
    parser.add_argument("--interval",    type=int, default=0, help="Intervalo de reporte em segundos")
    parser.add_argument("--keepalive",   type=int, default=0, help="Timeout de keepalive em segundos")
    parser.add_argument("--status-port", type=int, default=0, help="Porta da interface de diagnóstico")
    parser.add_argument("--debug", action="store_true", help="Logging detalhado")
    args = parser.parse_args()

    setup_logging(logging.DEBUG if args.debug else logging.INFO)

    if args.interval:    os.environ["P2S_INTERVAL"]     = str(args.interval)
    if args.keepalive:   os.environ["P2S_KEEPALIVE"]    = str(args.keepalive)
    if args.status_port: os.environ["P2S_STATUS_PORT"]  = str(args.status_port)

    sys.exit(run_p2s_server())
`;

export default function P2sServerCode() {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(P2S_SERVER_CODE);
    setCopied(true);
    toast.success('Código copiado!');
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownload = () => {
    const blob = new Blob([P2S_SERVER_CODE], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'p2s_server.py';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('p2s_server.py descarregado!');
  };

  return (
    <div className="space-y-4">
      {/* Como funciona */}
      <div className="p-3 bg-violet-50 border border-violet-200 rounded-xl text-xs text-violet-800 space-y-2">
        <p className="font-semibold text-sm">📡 O que é P2S (Push to Server / Conexão Inversa)?</p>
        <p>
          No modo P2S, <strong>o terminal inicia a conexão TCP ao servidor</strong> — não é o servidor a tentar alcançar o terminal.
          Isto é ideal quando o terminal está em rede privada/NAT sem IP externo acessível.
          O terminal ZKTeco usa <code className="bg-violet-100 px-1 rounded font-mono">SetServerPortAndTick(porta, 7)</code> para conectar ao servidor continuamente.
        </p>
        <div className="flex items-center gap-3 text-violet-700 font-mono text-xs bg-violet-100 px-2 py-1.5 rounded">
          <span>Terminal Biométrico</span>
          <span className="text-violet-500">──TCP→──</span>
          <span className="font-semibold">51.91.219.145:PORTA</span>
          <span className="text-violet-500">──→──</span>
          <span>P2S Server</span>
          <span className="text-violet-500">──→──</span>
          <span>NOC Monitor</span>
        </div>
      </div>

      {/* Compatibilidade */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[
          { brand: 'ZKTeco', models: 'F22, MB20, MA300, SpeedFace, ProBio, SilkBio, K20', config: 'SetServerPortAndTick(porta, 7)', color: 'blue' },
          { brand: 'Anviz', models: 'C2 Pro, W2 Pro, EP10, A5, D3, B37, CrossChex', config: 'Server Mode → IP:Porta', color: 'emerald' },
          { brand: 'Suprema', models: 'BioStation 2, BioStation A2, FaceStation 2, BioEntry W2', config: 'Server Connection → IP:Porta', color: 'violet' },
          { brand: 'Hikvision', models: 'DS-K1T671, DS-K1T341, Series K1', config: 'Platform → Active Registration', color: 'slate' },
          { brand: 'Dahua', models: 'ASI7213X, ASI3214S, Series ASI', config: 'Platform → Server Mode', color: 'orange' },
          { brand: 'Nitgen', models: 'eNBioAccess, WireFinger Series', config: 'Server Connection Mode', color: 'rose' },
        ].map(b => (
          <div key={b.brand} className={`p-2.5 rounded-lg border bg-${b.color}-50 border-${b.color}-200`}>
            <p className={`font-bold text-xs text-${b.color}-900`}>{b.brand}</p>
            <p className={`text-[10px] text-${b.color}-700 mt-0.5`}>{b.models}</p>
            <p className={`text-[10px] font-mono bg-${b.color}-100 px-1 rounded mt-1 text-${b.color}-800`}>{b.config}</p>
          </div>
        ))}
      </div>

      {/* Config JSON */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono space-y-0.5">
        <p className="text-slate-500 font-sans font-semibold mb-2">📄 C:\ProgramData\P2SServer\config.json</p>
        <p className="text-slate-700">{`{`}</p>
        <p className="text-slate-700 pl-4">{`"API_KEY":          "a_sua_api_key_pessoal",`}</p>
        <p className="text-slate-700 pl-4">{`"APP_ID":           "697aa46c9998c30665e2e19a",`}</p>
        <p className="text-slate-700 pl-4">{`"INTERVALO_REPORT": 20,`}</p>
        <p className="text-violet-700 pl-4 font-semibold">{`"KEEPALIVE_TIMEOUT": 60,`}</p>
        <p className="text-violet-700 pl-4 font-semibold">{`"STATUS_PORT": 9100`}</p>
        <p className="text-slate-700">{`}`}</p>
      </div>

      {/* Firewall */}
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
        <p className="font-semibold">🔥 Portas a abrir no Firewall do Windows Server (51.91.219.145)</p>
        <p>• <strong>5100–5xxx TCP (entrada)</strong> — Uma porta por terminal P2S (ex: 5100, 5101, 5102...)</p>
        <p>• <strong>9100 TCP (entrada)</strong> — Interface de diagnóstico HTTP <code className="bg-amber-100 px-1 rounded">/status</code></p>
        <p className="text-amber-700 mt-1">Firewall → Regras de Entrada → Nova Regra → Tipo: Porta → TCP → Porta específica</p>
      </div>

      {/* Config por fabricante */}
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 space-y-2">
        <p className="font-semibold">⚙️ Configuração no Terminal por Fabricante</p>
        <div className="space-y-1.5">
          <div>
            <p className="font-semibold">ZKTeco (via Software ZKAccess/Atentra):</p>
            <p className="font-mono bg-blue-100 px-2 py-1 rounded mt-0.5">
              Communication → Cloud Server → Server: 51.91.219.145 | Port: 5100 | Enable Push: ON
            </p>
          </div>
          <div>
            <p className="font-semibold">Anviz (via Web UI / CrossChex Cloud):</p>
            <p className="font-mono bg-blue-100 px-2 py-1 rounded mt-0.5">
              Network → Server Mode → Server IP: 51.91.219.145 | Server Port: 5100
            </p>
          </div>
          <div>
            <p className="font-semibold">Suprema (via BioStar 2):</p>
            <p className="font-mono bg-blue-100 px-2 py-1 rounded mt-0.5">
              Configuration → Network → Server Connection → IP: 51.91.219.145 | Port: 5100
            </p>
          </div>
        </div>
      </div>

      {/* Instalação */}
      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 space-y-1">
        <p className="font-semibold">⚡ Instalação no Windows Server como Serviço</p>
        <p>1. Python 3.9+ → <code className="bg-emerald-100 px-1 rounded">pip install requests</code></p>
        <p>2. Copiar <code className="bg-emerald-100 px-1 rounded">p2s_server.py</code> para <code className="bg-emerald-100 px-1 rounded">C:\Program Files\P2SServer\</code></p>
        <p>3. Criar <code className="bg-emerald-100 px-1 rounded">C:\ProgramData\P2SServer\config.json</code></p>
        <p>4. Instalar como serviço Windows com NSSM:</p>
        <code className="block bg-emerald-100 px-2 py-1 rounded mt-0.5">nssm install P2SServer "C:\Python311\python.exe" "C:\Program Files\P2SServer\p2s_server.py"</code>
        <code className="block bg-emerald-100 px-2 py-1 rounded mt-0.5">nssm set P2SServer AppDirectory "C:\Program Files\P2SServer"</code>
        <code className="block bg-emerald-100 px-2 py-1 rounded mt-0.5">nssm start P2SServer</code>
        <p className="mt-1">5. Verificar estado: <code className="bg-emerald-100 px-1 rounded">http://51.91.219.145:9100/status</code></p>
      </div>

      {/* Botões */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Server className="h-4 w-4 text-violet-500" />
          p2s_server.py — Servidor P2S Dedicado
        </p>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setExpanded(v => !v)}>
            {expanded ? <><ChevronUp className="h-4 w-4 mr-1" />Ocultar</> : <><ChevronDown className="h-4 w-4 mr-1" />Ver código</>}
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
        <pre className="bg-slate-900 text-violet-300 p-4 rounded-lg text-xs overflow-x-auto max-h-[600px] overflow-y-auto font-mono leading-relaxed whitespace-pre">
          {P2S_SERVER_CODE}
        </pre>
      )}
    </div>
  );
}