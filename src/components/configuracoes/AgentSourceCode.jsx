import React, { useState } from 'react';
import { Copy, Check, Code2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const AGENT_CODE = `# core_agent.py — Agente Local NOC Monitor
# Comunicacao protegida por X-Api-Key + X-App-Id obrigatorios em todos os pedidos.
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
    if api_key and app_id:
        return {"API_KEY": api_key, "APP_ID": app_id}
    if os.path.exists(CONFIG_FILE):
        try:
            cfg = json.loads(open(CONFIG_FILE, encoding="utf-8").read())
            if cfg.get("API_KEY") and cfg.get("APP_ID"):
                return cfg
        except Exception as e:
            logger.error(f"Falha ao ler config.json: {e}")
    return None


# ──────────────────────────────────────────────────────────────────
#  Autenticacao: TODOS os pedidos levam estes dois cabecalhos.
#  O servidor rejeita (401/403) qualquer pedido sem eles.
# ──────────────────────────────────────────────────────────────────
def _headers(api_key: str, app_id: str) -> dict:
    return {
        "X-Api-Key":     api_key,
        "X-App-Id":      app_id,
        "Content-Type":  "application/json",
    }


def listar_terminais(session, app_id: str, api_key: str) -> list:
    """GET agentGetTerminals — lista terminais do utilizador."""
    url = f"https://app.base44.app/api/apps/{app_id}/functions/agentGetTerminals"
    r = session.get(url, headers=_headers(api_key, app_id), timeout=10)
    r.raise_for_status()
    data = r.json()
    if not data.get("success"):
        raise ValueError(f"agentGetTerminals: {data}")
    return data.get("terminals", [])


def reportar_terminal(session, app_id: str, api_key: str,
                      terminal_id: str, status: str, latencia_ms):
    """POST agentReport — envia estado do terminal."""
    url = f"https://app.base44.app/api/apps/{app_id}/functions/agentReport"
    payload = {
        "terminal_id":      terminal_id,
        "status":           status,
        "latencia_ms":      latencia_ms,
        "segundos_sem_ping": 0,
    }
    r = session.post(url, headers=_headers(api_key, app_id), json=payload, timeout=10)
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

            # Validacao local minima antes de qualquer pedido de rede
            if not api_key.startswith("noc_"):
                logger.error("API Key invalida: deve comecar com 'noc_'. Verifique a configuracao.")
                for _ in range(30):
                    if stop_event and stop_event.is_set(): return 0
                    time.sleep(1)
                if once: break
                continue

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
                    logger.error(f"Auth falhada ({code}): verifique API_KEY e APP_ID.")
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

            for t in terminais:
                if stop_event and stop_event.is_set(): return 0
                try:
                    if not t.get("ativo", True): continue
                    host = escolher_host(t)
                    if not host:
                        logger.debug(f"Terminal {t.get('id')} sem host. Pulando.")
                        continue

                    porta = t.get("porta") or 80
                    sucesso, latencia = testar_http(session, host, porta)
                    if not sucesso:
                        sucesso, latencia = testar_tcp(host, porta)

                    status = "online" if sucesso else "offline"
                    reportar_terminal(session, app_id, api_key,
                                      terminal_id=t["id"],
                                      status=status,
                                      latencia_ms=latencia)
                    logger.info(
                        f"Testando {t.get('nome', t.get('id'))} ({host}:{porta})\\n"
                        f"-> {status} | latencia={latencia} ms"
                    )
                except requests.HTTPError as e:
                    code = e.response.status_code if e.response is not None else "?"
                    logger.error(f"Erro ao reportar terminal {t.get('id')} (HTTP {code}): verifique credenciais.")
                except Exception as e:
                    logger.error(f"Erro terminal {t.get('id')}: {e}")

            for _ in range(intervalo):
                if stop_event and stop_event.is_set(): return 0
                time.sleep(1)
            if once: break
        return 0
    finally:
        lock.release()
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
          <Code2 className="h-4 w-4" /> Código fonte — core_agent.py (seguro)
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

      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
        <strong>Segurança:</strong> Este agente usa <code className="bg-amber-100 px-1 rounded">X-Api-Key</code> e <code className="bg-amber-100 px-1 rounded">X-App-Id</code> em <strong>todos</strong> os pedidos.
        Qualquer pedido sem estes dois cabeçalhos é rejeitado com <strong>401/403</strong>.
        Os endpoints corretos são <code className="bg-amber-100 px-1 rounded">agentGetTerminals</code> (GET) e <code className="bg-amber-100 px-1 rounded">agentReport</code> (POST).
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