import React, { useState } from 'react';
import { Copy, Check, Code2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const AGENT_CODE = `# core_agent.py — Agente Local NOC Monitor
# Instalacao: C:\\Program Files\\Base44Agent\\core_agent.py
# Config:     C:\\ProgramData\\Base44Agent\\config.json  (veja exemplo abaixo)
# Logs:       C:\\ProgramData\\Base44Agent\\agent.log
#
# config.json exemplo:
# {
#   "API_KEY": "a_sua_api_key_pessoal",
#   "APP_ID":  "697aa46c9998c30665e2e19a"
# }
#
# Tipos de conexao suportados: ip_local, ip_publico, dns, api
# Para terminais P2S (conexao inversa), use o p2s_server.py dedicado.
#
# INICIAR COMO SERVICO WINDOWS (NSSM):
#   nssm install Base44Agent "C:\\Python311\\python.exe" "C:\\Program Files\\Base44Agent\\core_agent.py"
#   nssm set Base44Agent AppDirectory "C:\\Program Files\\Base44Agent"
#   nssm start Base44Agent

import os, sys, json, time, socket, logging, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from logging.handlers import RotatingFileHandler
import requests

# ──────────────────────────────────────────────────────────────
# Paths e Constantes
# ──────────────────────────────────────────────────────────────
PROGRAMDATA = os.environ.get("PROGRAMDATA", r"C:\\ProgramData")
APP_DIR      = os.path.join(PROGRAMDATA, "Base44Agent")
CONFIG_FILE  = os.path.join(APP_DIR, "config.json")
LOG_FILE     = os.path.join(APP_DIR, "agent.log")
LOCK_FILE    = os.path.join(APP_DIR, "agent.lock")

DEFAULT_INTERVAL = 30       # segundos entre ciclos
TIMEOUT          = 5        # timeout TCP/HTTP por terminal
MAX_WORKERS      = 20       # threads paralelas para monitorar terminais

BASE_URL = "https://app.base44.app/api/apps/{app_id}/functions"

logger = logging.getLogger("base44agent")


# ──────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────
def setup_logging(level=logging.INFO):
    os.makedirs(APP_DIR, exist_ok=True)
    h   = RotatingFileHandler(LOG_FILE, maxBytes=1_000_000, backupCount=3, encoding="utf-8")
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
# Instancia unica (evitar dupla execucao)
# ──────────────────────────────────────────────────────────────
class SingleInstance:
    def __init__(self, path):
        self.path = path
        self.fp   = None

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
# Configuracao
# ──────────────────────────────────────────────────────────────
def load_config():
    """Carrega config de variaveis de ambiente ou config.json."""
    api_key = os.environ.get("BASE44_API_KEY", "").strip()
    app_id  = os.environ.get("BASE44_APP_ID",  "").strip()
    if api_key and app_id and len(api_key) >= 16:
        return {"API_KEY": api_key, "APP_ID": app_id}

    if os.path.exists(CONFIG_FILE):
        try:
            cfg     = json.load(open(CONFIG_FILE, encoding="utf-8"))
            api_key = (cfg.get("API_KEY") or "").strip()
            app_id  = (cfg.get("APP_ID")  or "").strip()
            if api_key and app_id and len(api_key) >= 16:
                return {"API_KEY": api_key, "APP_ID": app_id}
            logger.error("config.json invalido: API_KEY ou APP_ID ausentes/curtos.")
        except Exception as e:
            logger.error(f"Falha ao ler config.json: {e}")
    return None


# ──────────────────────────────────────────────────────────────
# API Helpers
# ──────────────────────────────────────────────────────────────
def _headers(api_key):
    return {"X-Api-Key": api_key, "Content-Type": "application/json"}


def listar_terminais(session, app_id, api_key):
    """Busca terminais do utilizador via agentGetTerminals."""
    url = f"{BASE_URL.format(app_id=app_id)}/agentGetTerminals"
    r   = session.post(url, headers=_headers(api_key), json={}, timeout=10)
    r.raise_for_status()
    data = r.json()
    if not data.get("success"):
        raise ValueError(f"agentGetTerminals erro: {data}")
    return data.get("terminals", [])


def reportar_terminal(session, app_id, api_key, terminal_id,
                      status, latencia_ms, segundos_sem_ping=0):
    """Reporta status de um terminal via agentReport."""
    url     = f"{BASE_URL.format(app_id=app_id)}/agentReport"
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
# Testes de Conectividade
# ──────────────────────────────────────────────────────────────
def testar_tcp(host, porta):
    t = time.time()
    try:
        with socket.create_connection((host, int(porta)), timeout=TIMEOUT):
            return True, int((time.time() - t) * 1000)
    except Exception:
        return False, None


def testar_http(session, host, porta):
    t = time.time()
    try:
        r = session.get(f"http://{host}:{porta}", timeout=TIMEOUT)
        return True, int((time.time() - t) * 1000)
    except Exception:
        return False, None


def testar_api_endpoint(session, url):
    t = time.time()
    try:
        r = session.get(url, timeout=TIMEOUT)
        return r.status_code < 500, int((time.time() - t) * 1000)
    except Exception:
        return False, None


# ──────────────────────────────────────────────────────────────
# Loop Principal — monitoramento paralelo
# ──────────────────────────────────────────────────────────────
def testar_e_reportar(t, app_id, api_key):
    """Testa um terminal e reporta o status. Executado em thread separada."""
    # Cada thread tem a sua propria sessao HTTP para evitar problemas de concorrencia
    sess = requests.Session()
    tid  = t["id"]
    nome = t.get("nome", tid)
    tipo = t.get("tipo_conexao", "ip_local")
    porta_raw = t.get("porta") or 5005

    try:
        if tipo == "api":
            endpoint = t.get("api_endpoint", "")
            if not endpoint:
                logger.debug(f"{nome}: api_endpoint vazio, ignorado.")
                return
            online, latencia = testar_api_endpoint(sess, endpoint)
            seg_sem_ping = 0
            status = "online" if online else "offline"
            logger.info(f"{nome} [api] -> {status.upper()} | latencia={latencia}ms")

        else:
            # ip_local, ip_publico, dns — testa TCP direto ao terminal
            if tipo == "ip_local":
                host = t.get("ip_local")
            elif tipo == "ip_publico":
                host = t.get("ip_publico")
            else:  # dns
                host = t.get("dns")

            if not host:
                logger.debug(f"{nome}: host nao configurado para tipo={tipo}, ignorado.")
                return

            porta = int(porta_raw)
            # Tenta TCP primeiro (mais rapido e fiavel para terminais biometricos)
            online, latencia = testar_tcp(host, porta)
            if not online:
                # Fallback HTTP
                online, latencia = testar_http(sess, host, porta)
            seg_sem_ping = 0 if online else int(TIMEOUT)
            status = "online" if online else "offline"
            logger.info(f"{nome} [{tipo}] {host}:{porta} -> {status.upper()} | latencia={latencia}ms")

        reportar_terminal(sess, app_id, api_key,
                          terminal_id=tid,
                          status=status,
                          latencia_ms=latencia,
                          segundos_sem_ping=seg_sem_ping)

    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else "?"
        logger.error(f"Erro ao reportar {nome} (HTTP {code})")
    except Exception as e:
        logger.error(f"Erro no terminal {nome}: {e}")
    finally:
        sess.close()


def ciclo_monitoramento(app_id, api_key):
    """Executa um ciclo completo: busca terminais e testa TODOS em paralelo."""
    sess = requests.Session()
    try:
        terminais = listar_terminais(sess, app_id, api_key)
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else "?"
        if code in (401, 403):
            logger.error(f"Autenticacao falhada ({code}): verifique a API_KEY no config.json.")
        else:
            logger.error(f"Erro ao listar terminais (HTTP {code}): {e}")
        return
    except Exception as e:
        logger.error(f"Erro ao listar terminais: {e}")
        return
    finally:
        sess.close()

    ativos = [t for t in terminais if t.get("ativo", True)]
    if not ativos:
        logger.info("Nenhum terminal ativo a monitorizar.")
        return

    logger.info(f"Ciclo iniciado — {len(ativos)} terminal(is) em paralelo (workers={MAX_WORKERS})")
    t0 = time.time()

    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(ativos))) as executor:
        futures = {executor.submit(testar_e_reportar, t, app_id, api_key): t for t in ativos}
        for future in as_completed(futures):
            try:
                future.result()
            except Exception as e:
                t = futures[future]
                logger.error(f"Thread erro para {t.get('nome', t.get('id'))}: {e}")

    logger.info(f"Ciclo concluido em {time.time()-t0:.1f}s")


def run_agent(intervalo=DEFAULT_INTERVAL, once=False, stop_event=None):
    os.makedirs(APP_DIR, exist_ok=True)
    lock = SingleInstance(LOCK_FILE)
    if not lock.acquire():
        logger.error("Outra instancia ja esta em execucao. Encerrando.")
        return 2

    try:
        while True:
            if stop_event and stop_event.is_set():
                return 0

            config = load_config()
            if not config:
                logger.warning("config.json ausente ou invalido. A aguardar 10s...")
                for _ in range(10):
                    if stop_event and stop_event.is_set(): return 0
                    time.sleep(1)
                if once: break
                continue

            ciclo_monitoramento(config["APP_ID"], config["API_KEY"])

            if once:
                break

            # Aguardar intervalo com suporte a stop_event
            for _ in range(intervalo):
                if stop_event and stop_event.is_set(): return 0
                time.sleep(1)

        return 0
    finally:
        lock.release()


# ──────────────────────────────────────────────────────────────
# Entry Point
# ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="NOC Monitor - Agente Local")
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL,
                        help="Intervalo em segundos entre ciclos (default: 30)")
    parser.add_argument("--once",  action="store_true",
                        help="Executar apenas um ciclo e sair")
    parser.add_argument("--debug", action="store_true",
                        help="Ativar logging detalhado (DEBUG)")
    args = parser.parse_args()

    setup_logging(logging.DEBUG if args.debug else logging.INFO)
    logger.info(f"Agente iniciado | intervalo={args.interval}s | once={args.once} | debug={args.debug}")
    sys.exit(run_agent(intervalo=args.interval, once=args.once))
`;

export default function AgentSourceCode() {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(AGENT_CODE);
    setCopied(true);
    toast.success('Código copiado!');
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownload = () => {
    const blob = new Blob([AGENT_CODE], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'core_agent.py';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('core_agent.py descarregado!');
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Code2 className="h-4 w-4" /> Código fonte — core_agent.py
        </p>
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

      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 space-y-1">
        <p><strong>Tipos suportados:</strong> ip_local · ip_publico · dns · api</p>
        <p><strong>⚡ Paralelo:</strong> todos os terminais são testados simultaneamente (até 20 threads) — sem lentidão independente do número de terminais.</p>
        <p><strong>Segurança:</strong> autentica via <code className="bg-emerald-100 px-1 rounded font-mono">X-Api-Key</code> pessoal — cada agente acede apenas aos seus terminais.</p>
        <p><strong>P2S:</strong> use o <strong>p2s_server.py</strong> dedicado (disponível em Administração → P2S Server).</p>
      </div>

      {expanded && (
        <div className="relative">
          <pre className="bg-slate-900 text-emerald-400 p-4 rounded-lg text-xs overflow-x-auto max-h-[500px] overflow-y-auto font-mono leading-relaxed whitespace-pre">
            {AGENT_CODE}
          </pre>
        </div>
      )}
    </div>
  );
}