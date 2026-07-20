import React, { useState } from 'react';
import { Copy, Check, Code2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { appParams } from '@/lib/app-params';

const ADMS_SERVER_CODE = `# adms_server.py — Servidor ADMS/iClock para terminais ZKTeco e Anviz
# Instalacao: C:\\Program Files\\Base44Agent\\adms_server.py
# Config:     C:\\ProgramData\\Base44Agent\\config.json  (partilhado com core_agent.py)
# Logs:       C:\\ProgramData\\Base44Agent\\adms_server.log
#
# config.json exemplo:
# {
#   "API_KEY": "a_sua_api_key_pessoal",
#   "APP_ID":  "${appParams.appId}",
#   "ADMS_PORT": 8080
# }
#
# RESPONSABILIDADE:
#   Recebe os HTTP POST dos terminais ZKTeco/Anviz em /iclock/cdata e /iclock/getrequest
#   e reporta o ultimo ping ao NOC Monitor via endpoint admsReport.
#
# TERMINAIS SUPORTADOS:
#   - ZKTeco (protocolo iClock/ADMS): MA300, F22, UA860, SpeedFace, etc.
#   - Anviz (CrossChex Cloud): C2 Pro, EP300, W2, etc.
#   - Qualquer terminal que use protocolo ADMS/iClock HTTP
#
# PORTA PADRÃO: 8080 (configurar no terminal como endereco do servidor ADMS)
#
# INICIAR COMO SERVICO WINDOWS (NSSM):
#   nssm install Base44AdmsServer "C:\\Python311\\python.exe" "C:\\Program Files\\Base44Agent\\adms_server.py"
#   nssm set Base44AdmsServer AppDirectory "C:\\Program Files\\Base44Agent"
#   nssm start Base44AdmsServer

import os, sys, json, logging, threading
from logging.handlers import RotatingFileHandler
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import requests

# ──────────────────────────────────────────────────────────────
# Paths e Constantes
# ──────────────────────────────────────────────────────────────
PROGRAMDATA = os.environ.get("PROGRAMDATA", r"C:\\ProgramData")
APP_DIR      = os.path.join(PROGRAMDATA, "Base44Agent")
CONFIG_FILE  = os.path.join(APP_DIR, "config.json")
LOG_FILE     = os.path.join(APP_DIR, "adms_server.log")
DEFAULT_PORT = 8080

BASE_URL = "https://app.base44.app/api/apps/{app_id}/functions"

logger = logging.getLogger("adms_server")


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
# Configuracao
# ──────────────────────────────────────────────────────────────
def load_config():
    api_key = os.environ.get("BASE44_API_KEY", "").strip()
    app_id  = os.environ.get("BASE44_APP_ID",  "").strip()
    port    = int(os.environ.get("ADMS_PORT", DEFAULT_PORT))
    if api_key and app_id and len(api_key) >= 16:
        return {"API_KEY": api_key, "APP_ID": app_id, "ADMS_PORT": port}

    if os.path.exists(CONFIG_FILE):
        try:
            cfg     = json.load(open(CONFIG_FILE, encoding="utf-8"))
            api_key = (cfg.get("API_KEY") or "").strip()
            app_id  = (cfg.get("APP_ID")  or "").strip()
            port    = int(cfg.get("ADMS_PORT", DEFAULT_PORT))
            if api_key and app_id and len(api_key) >= 16:
                return {"API_KEY": api_key, "APP_ID": app_id, "ADMS_PORT": port}
            logger.error("config.json invalido: API_KEY ou APP_ID ausentes.")
        except Exception as e:
            logger.error(f"Falha ao ler config.json: {e}")
    return None


# ──────────────────────────────────────────────────────────────
# Reporte ao NOC Monitor
# ──────────────────────────────────────────────────────────────
_config_cache = None
_config_lock  = threading.Lock()

def get_config():
    global _config_cache
    with _config_lock:
        _config_cache = load_config()
        return _config_cache

def reportar_ping(numero_serie, ip_terminal):
    cfg = get_config()
    if not cfg:
        logger.warning(f"Config nao disponivel — ping de SN={numero_serie} ignorado")
        return False

    url = f"{BASE_URL.format(app_id=cfg['APP_ID'])}/admsReport"
    payload = {
        "numero_serie": numero_serie,
        "status":       "online",
        "ip_terminal":  ip_terminal,
    }
    headers = {
        "X-Api-Key":    cfg["API_KEY"],
        "Content-Type": "application/json",
    }
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=10)
        r.raise_for_status()
        data = r.json()
        logger.info(f"SN={numero_serie} [{ip_terminal}] -> reportado OK | terminal={data.get('terminal_nome','?')} mudou={data.get('mudou',False)}")
        return True
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else "?"
        logger.error(f"SN={numero_serie}: erro HTTP {code} ao reportar")
    except Exception as e:
        logger.error(f"SN={numero_serie}: erro ao reportar: {e}")
    return False


# ──────────────────────────────────────────────────────────────
# Handler HTTP (protocolo iClock/ADMS)
# ──────────────────────────────────────────────────────────────
class AdmsHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        pass  # silenciar log HTTP padrao — usamos o nosso

    def _send(self, code, body="OK"):
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body.encode())))
        self.end_headers()
        self.wfile.write(body.encode())

    def do_GET(self):
        """
        Terminais ZKTeco enviam GET /iclock/getrequest?SN=XXXXXXXX para pedir comandos.
        Responder com 'OK' e aproveitar para registar o ping.
        """
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        sn = (params.get("SN") or params.get("sn") or [""])[0].strip()

        if sn:
            ip_terminal = self.client_address[0]
            logger.info(f"GET {self.path} | SN={sn} | IP={ip_terminal}")
            threading.Thread(target=reportar_ping, args=(sn, ip_terminal), daemon=True).start()
        else:
            logger.debug(f"GET {self.path} sem SN — ignorado")

        self._send(200, "OK")

    def do_POST(self):
        """
        Terminais ZKTeco/Anviz enviam POST /iclock/cdata?SN=XXXXXXXX&table=ATTLOG
        com marcacoes de presenca. Registar o ping e responder com OK.
        """
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        sn = (params.get("SN") or params.get("sn") or [""])[0].strip()

        # Ler body (necessario para nao bloquear o cliente)
        content_length = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_length) if content_length > 0 else b""

        # Tentar extrair SN do body se nao veio na query
        if not sn and body_bytes:
            try:
                body_str = body_bytes.decode("utf-8", errors="ignore")
                body_params = parse_qs(body_str)
                sn = (body_params.get("SN") or body_params.get("sn") or [""])[0].strip()
            except Exception:
                pass

        if sn:
            ip_terminal = self.client_address[0]
            table = (params.get("table") or ["cdata"])[0]
            logger.info(f"POST {self.path} | SN={sn} | table={table} | IP={ip_terminal} | {len(body_bytes)}b")
            threading.Thread(target=reportar_ping, args=(sn, ip_terminal), daemon=True).start()
        else:
            logger.debug(f"POST {self.path} sem SN — ignorado")

        # Resposta padrao iClock: OK seguido de comandos (vazio = sem comandos pendentes)
        self._send(200, "OK")


# ──────────────────────────────────────────────────────────────
# Entry Point
# ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="NOC Monitor - Servidor ADMS/iClock")
    parser.add_argument("--port",  type=int, default=None, help="Porta a escutar (default: config.json ou 8080)")
    parser.add_argument("--debug", action="store_true",    help="Ativar logging detalhado (DEBUG)")
    args = parser.parse_args()

    setup_logging(logging.DEBUG if args.debug else logging.INFO)

    cfg = load_config()
    if not cfg:
        logger.critical("Config nao encontrada. Crie C:\\\\ProgramData\\\\Base44Agent\\\\config.json com API_KEY e APP_ID.")
        sys.exit(1)

    port = args.port or cfg.get("ADMS_PORT", DEFAULT_PORT)

    logger.info(f"ADMS Server iniciado | porta={port} | APP_ID={cfg['APP_ID']}")
    logger.info(f"Configurar terminais ZKTeco/Anviz com servidor ADMS: <IP_WINDOWS_SERVER>:{port}")

    try:
        server = HTTPServer(("0.0.0.0", port), AdmsHandler)
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Servidor parado.")
    except OSError as e:
        logger.critical(f"Erro ao iniciar servidor na porta {port}: {e}")
        sys.exit(1)
`;

export default function AdmsServerCode() {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(ADMS_SERVER_CODE);
    setCopied(true);
    toast.success('Código copiado!');
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownload = () => {
    const blob = new Blob([ADMS_SERVER_CODE], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'adms_server.py';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('adms_server.py descarregado!');
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Code2 className="h-4 w-4" /> Código fonte — adms_server.py
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

      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 space-y-1">
        <p><strong>Responsabilidade:</strong> recebe os HTTP POST/GET dos terminais <strong>ZKTeco e Anviz</strong> (protocolo iClock/ADMS) e reporta o ping ao NOC Monitor.</p>
        <p><strong>Porta padrão:</strong> <code className="bg-blue-100 px-1 rounded font-mono">8080</code> — configurar nos terminais como "Endereço do Servidor ADMS".</p>
        <p><strong>Configuração:</strong> partilha o <code className="bg-blue-100 px-1 rounded font-mono">config.json</code> do Agente Local (<code className="bg-blue-100 px-1 rounded font-mono">C:\ProgramData\Base44Agent\</code>).</p>
        <p><strong>Terminais suportados:</strong> ZKTeco MA300, F22, UA860, SpeedFace · Anviz C2 Pro, EP300, W2 · qualquer terminal com protocolo ADMS/iClock.</p>
        <p><strong>Lookup automático:</strong> identifica o terminal pelo <code className="bg-blue-100 px-1 rounded font-mono">Número de Série (SN)</code> configurado no terminal do NOC Monitor.</p>
      </div>

      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
        <p><strong>⚠️ Pré-requisito:</strong> o campo <strong>"Número de Série"</strong> do terminal no NOC Monitor deve corresponder exatamente ao SN do equipamento físico.</p>
      </div>

      {expanded && (
        <div className="relative">
          <pre className="bg-slate-900 text-blue-300 p-4 rounded-lg text-xs overflow-x-auto max-h-[500px] overflow-y-auto font-mono leading-relaxed whitespace-pre">
            {ADMS_SERVER_CODE}
          </pre>
        </div>
      )}
    </div>
  );
}