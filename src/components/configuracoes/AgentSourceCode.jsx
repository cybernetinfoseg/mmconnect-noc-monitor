import React, { useState } from 'react';
import { Copy, Check, Code2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const AGENT_CODE = `# core_agent.py — Agente Local NOC Monitor
# Instalacao: C:\\Program Files\\Base44Agent\\core_agent.py
# Config:     C:\\ProgramData\\Base44Agent\\config.json
# Logs:       C:\\ProgramData\\Base44Agent\\agent.log
# Autenticacao: apenas X-Api-Key pessoal. Sem ela, todos os pedidos sao rejeitados.
import os, sys, json, time, socket, logging
from logging.handlers import RotatingFileHandler
from datetime import datetime, timezone, timedelta
import requests

PROGRAMDATA = os.environ.get("PROGRAMDATA", r"C:\\\\ProgramData")
APP_DIR     = os.path.join(PROGRAMDATA, "Base44Agent")
CONFIG_FILE = os.path.join(APP_DIR, "config.json")
LOG_FILE    = os.path.join(APP_DIR, "agent.log")
LOCK_FILE   = os.path.join(APP_DIR, "agent.lock")

DEFAULT_INTERVAL = 30
TIMEOUT          = 3
UPDATE_EVERY     = timedelta(hours=6)

logger = logging.getLogger("base44agent")


def setup_logging(level=logging.INFO):
    os.makedirs(APP_DIR, exist_ok=True)
    h = RotatingFileHandler(LOG_FILE, maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    fmt = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s", "%Y-%m-%d %H:%M:%S")
    logger.handlers.clear()
    h.setFormatter(fmt); logger.addHandler(h); logger.setLevel(level)
    if sys.stdout.isatty() or sys.stderr.isatty():
        sh = logging.StreamHandler(); sh.setFormatter(fmt); sh.setLevel(level)
        logger.addHandler(sh)


class SingleInstance:
    def __init__(self, path): self.path = path; self.fp = None
    def acquire(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self.fp = open(self.path, "a+")
        try:
            import msvcrt
            msvcrt.locking(self.fp.fileno(), msvcrt.LK_NBLCK, 1)
            self.fp.seek(0); self.fp.truncate(); self.fp.write(str(os.getpid())); self.fp.flush()
            return True
        except Exception:
            if self.fp: self.fp.close(); self.fp = None
            return False
    def release(self):
        try:
            if self.fp:
                try:
                    import msvcrt
                    self.fp.seek(0); self.fp.truncate()
                    msvcrt.locking(self.fp.fileno(), msvcrt.LK_UNLCK, 1)
                finally: self.fp.close()
        except Exception: pass


def load_config():
    api_key = os.environ.get("BASE44_API_KEY", "").strip()
    app_id  = os.environ.get("BASE44_APP_ID",  "").strip()
    if api_key and app_id and len(api_key) >= 16:
        return {"API_KEY": api_key, "APP_ID": app_id}
    if os.path.exists(CONFIG_FILE):
        try:
            cfg = json.loads(open(CONFIG_FILE, encoding="utf-8").read())
            key = (cfg.get("API_KEY") or "").strip()
            aid = (cfg.get("APP_ID")  or "").strip()
            if key and aid and len(key) >= 16:
                return {"API_KEY": key, "APP_ID": aid}
            if aid and not key:
                logger.error("SEGURANCA: API_KEY esta vazia no config.json — agente bloqueado ate configuracao valida.")
            elif key and len(key) < 16:
                logger.error("SEGURANCA: API_KEY demasiado curta — agente bloqueado.")
        except Exception as e:
            logger.error(f"Falha ao ler config.json: {e}")
    return None


# ──────────────────────────────────────────────────────────────────
#  Autenticacao: APENAS X-Api-Key pessoal.
#  O servidor rejeita (401) qualquer pedido sem ela ou com key invalida.
# ──────────────────────────────────────────────────────────────────
def _headers(api_key: str) -> dict:
    return {
        "X-Api-Key":     api_key,
        "Content-Type":  "application/json",
    }


def listar_terminais(session, app_id: str, api_key: str) -> list:
    """POST agentGetTerminals — lista terminais do utilizador."""
    url = f"https://app.base44.app/api/apps/{app_id}/functions/agentGetTerminals"
    r = session.post(url, headers=_headers(api_key), json={"api_key": api_key}, timeout=10)
    r.raise_for_status()
    data = r.json()
    if not data.get("success"):
        raise ValueError(f"agentGetTerminals: {data}")
    return data.get("terminals", [])


def reportar_terminal(session, app_id: str, api_key: str,
                      terminal_id: str, status: str, latencia_ms,
                      segundos_sem_ping: int = 0):
    """POST agentReport — envia estado do terminal."""
    url = f"https://app.base44.app/api/apps/{app_id}/functions/agentReport"
    payload = {
        "terminal_id":       terminal_id,
        "status":            status,
        "latencia_ms":       latencia_ms,
        "segundos_sem_ping": segundos_sem_ping,
    }
    r = session.post(url, headers=_headers(api_key), json=payload, timeout=10)
    r.raise_for_status()
    return r.json()


def testar_http(session, host, porta):
    t = time.time()
    try:
        session.get(f"http://{host}:{porta}", timeout=TIMEOUT)
        return True, int((time.time()-t)*1000)
    except Exception: return False, None


def testar_tcp(host, porta):
    t = time.time()
    try:
        with socket.create_connection((host, int(porta)), timeout=TIMEOUT):
            return True, int((time.time()-t)*1000)
    except Exception: return False, None


def testar_api_endpoint(session, url):
    t = time.time()
    try:
        r = session.get(url, timeout=TIMEOUT)
        return r.status_code < 500, int((time.time()-t)*1000)
    except Exception: return False, None


def escolher_host(t):
    return t.get("ip_local") or t.get("ip_publico") or t.get("dns")


def run_agent(intervalo=DEFAULT_INTERVAL, enable_update=True, once=False,
              stop_event=None, check_update_safe=None):
    os.makedirs(APP_DIR, exist_ok=True)
    lock = SingleInstance(LOCK_FILE)
    if not lock.acquire():
        logger.error("Outra instancia ja esta em execucao. Encerrando.")
        return 2

    session = requests.Session()
    last_update_check = datetime.min.replace(tzinfo=timezone.utc)

    try:
        while True:
            if stop_event and stop_event.is_set():
                return 0

            config = load_config()
            if not config:
                logger.warning("Configuracao ausente. Aguardando...")
                for _ in range(10):
                    if stop_event and stop_event.is_set(): return 0
                    time.sleep(1)
                if once: break
                continue

            api_key = config["API_KEY"]
            app_id  = config["APP_ID"]

            agora = datetime.now(timezone.utc)
            if enable_update and check_update_safe and (agora - last_update_check) >= UPDATE_EVERY:
                try:
                    if check_update_safe(): return 0
                except Exception as e: logger.error(f"Erro update: {e}")
                finally: last_update_check = agora

            try:
                terminais = listar_terminais(session, app_id, api_key)
            except requests.HTTPError as e:
                code = e.response.status_code if e.response is not None else "?"
                if code in (401, 403):
                    logger.error(f"Auth falhada ({code}): verifique a sua API_KEY pessoal.")
                else:
                    logger.error(f"Falha ao listar terminais (HTTP {code}): {e}")
                for _ in range(intervalo):
                    if stop_event and stop_event.is_set(): return 0
                    time.sleep(1)
                if once: break
                continue
            except Exception as e:
                logger.error(f"Falha ao listar terminais: {e}")
                for _ in range(intervalo):
                    if stop_event and stop_event.is_set(): return 0
                    time.sleep(1)
                if once: break
                continue

            t0_ciclo = time.time()
            for t in terminais:
                if stop_event and stop_event.is_set(): return 0
                try:
                    if not t.get("ativo", True): continue

                    tipo = t.get("tipo_conexao", "ip_local")
                    api_endpoint = t.get("api_endpoint")

                    # Terminais tipo "api": usar endpoint directamente
                    if tipo == "api" and api_endpoint:
                        sucesso, latencia = testar_api_endpoint(session, api_endpoint)
                        host_desc = api_endpoint
                    else:
                        host = escolher_host(t)
                        if not host:
                            logger.debug(f"Terminal {t.get('id')} sem host. Pulando.")
                            continue
                        porta = t.get("porta") or 80
                        sucesso, latencia = testar_http(session, host, porta)
                        if not sucesso:
                            sucesso, latencia = testar_tcp(host, porta)
                        host_desc = f"{host}:{porta}"

                    # Calcular segundos_sem_ping reais desde inicio do ciclo
                    segundos_sem_ping = int(time.time() - t0_ciclo) if not sucesso else 0

                    status = "online" if sucesso else "offline"
                    reportar_terminal(session, app_id, api_key,
                                      terminal_id=t["id"],
                                      status=status,
                                      latencia_ms=latencia,
                                      segundos_sem_ping=segundos_sem_ping)
                    logger.info(
                        f"Testando {t.get('nome', t.get('id'))} ({host_desc})\\n"
                        f"-> {status} | latencia={latencia} ms"
                    )
                except requests.HTTPError as e:
                    code = e.response.status_code if e.response is not None else "?"
                    logger.error(f"Erro ao reportar terminal {t.get('id')} (HTTP {code}): verifique a sua API_KEY.")
                except Exception as e:
                    logger.error(f"Erro terminal {t.get('id')}: {e}")

            for _ in range(intervalo):
                if stop_event and stop_event.is_set(): return 0
                time.sleep(1)
            if once: break
        return 0
    finally:
        lock.release()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="NOC Monitor — Agente Local")
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL, help="Intervalo em segundos (default: 30)")
    parser.add_argument("--once", action="store_true", help="Executar apenas um ciclo e sair")
    parser.add_argument("--debug", action="store_true", help="Ativar logging detalhado")
    args = parser.parse_args()

    setup_logging(logging.DEBUG if args.debug else logging.INFO)
    logger.info(f"Agente iniciado | intervalo={args.interval}s | once={args.once}")
    sys.exit(run_agent(intervalo=args.interval, enable_update=False, once=args.once))
`;

export default function AgentSourceCode() {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(AGENT_CODE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Code2 className="h-4 w-4" /> Código fonte — core_agent.py
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setExpanded(v => !v)}>
            {expanded ? 'Ocultar' : 'Ver código'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copiado!' : 'Copiar'}
          </Button>
        </div>
      </div>

      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
        <strong>Segurança:</strong> Este agente autentica-se exclusivamente pela <code className="bg-emerald-100 px-1 rounded">X-Api-Key</code> pessoal.
        Qualquer pedido sem ela ou com key inválida é rejeitado com <strong>401</strong>.
        O servidor isola automaticamente os terminais de cada utilizador.
      </div>

      {expanded && (
        <div className="relative">
          <pre className="bg-slate-900 text-emerald-400 p-4 rounded-lg text-xs overflow-x-auto max-h-96 overflow-y-auto font-mono leading-relaxed">
            {AGENT_CODE}
          </pre>
        </div>
      )}
    </div>
  );
}