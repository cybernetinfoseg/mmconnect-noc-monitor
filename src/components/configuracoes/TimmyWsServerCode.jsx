import React, { useState } from 'react';
import { Copy, Check, Download, Server, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const TIMMY_WS_CODE = `# timmy_ws_server.py — NOC Monitor: Servidor WebSocket Cloud (Protocolo Timmy/THbio)
# Compatível com: Timmy TM-AI07F, TM-AIFace11F, TFS30, TFS50 e outros modelos THbio
# Protocolo: WebSocket + JSON (RFC 6455) — porta padrão 7788 (configurável)
#
# O terminal conecta-se ao servidor WebSocket e envia:
#   1. cmd:"reg"     — registo inicial com SN, modelo, firmware
#   2. cmd:"sendlog" — logs de presença em tempo real (heartbeat implícito)
#   3. Heartbeat a cada 3s (configurável no terminal)
#
# Config: C:\\ProgramData\\TimmyWSServer\\config.json
# {
#   "API_KEY": "a_sua_api_key_pessoal",
#   "APP_ID":  "697aa46c9998c30665e2e19a",
#   "WS_PORT": 7788
# }
#
# Instalação (Windows):
#   pip install websockets requests
#   nssm install TimmyWSServer "C:\\Python311\\python.exe" "C:\\Program Files\\NOCMonitor\\timmy_ws_server.py"
#   nssm start TimmyWSServer
#
# Configuração no terminal Timmy:
#   MENU → Comm Set → Server → Server Req: Yes
#   Use domainNm: Yes → DomainNm: SEU_IP_OU_DOMINIO
#   SerPortNo: 7788
#   Heartbeat: 3s
#   Server approval: No

import os, sys, json, time, logging, asyncio, threading
from logging.handlers import RotatingFileHandler
import requests

try:
    import websockets
    from websockets.server import serve
except ImportError:
    print("ERRO: instale 'websockets' com: pip install websockets")
    sys.exit(1)

# ──────────────────────────────────────────────────────────────
# Constantes e Paths
# ──────────────────────────────────────────────────────────────
PROGRAMDATA  = os.environ.get("PROGRAMDATA", r"C:\\ProgramData")
APP_DIR      = os.path.join(PROGRAMDATA, "TimmyWSServer")
CONFIG_FILE  = os.path.join(APP_DIR, "config.json")
LOG_FILE     = os.path.join(APP_DIR, "timmy_ws.log")

DEFAULT_WS_PORT  = 7788
OFFLINE_TIMEOUT  = 30    # segundos sem mensagem → offline (3x o heartbeat padrão de 3s com margem)
BASE_URL = "https://app.base44.app/api/apps/{app_id}/functions"

logger = logging.getLogger("timmy_ws")

# Estado em memória: SN → { terminal_id, nome, last_seen, latencia_ms, connected }
ws_state = {}
ws_lock  = threading.Lock()

# Mapa SN → terminal_id (carregado da API)
sn_to_terminal = {}
sn_to_nome     = {}


# ──────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────
def setup_logging(debug=False):
    os.makedirs(APP_DIR, exist_ok=True)
    h   = RotatingFileHandler(LOG_FILE, maxBytes=5_000_000, backupCount=5, encoding="utf-8")
    fmt = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s", "%Y-%m-%d %H:%M:%S")
    h.setFormatter(fmt)
    logger.addHandler(h)
    logger.setLevel(logging.DEBUG if debug else logging.INFO)
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    logger.addHandler(sh)


# ──────────────────────────────────────────────────────────────
# API Helpers
# ──────────────────────────────────────────────────────────────
def _headers(api_key):
    return {"X-Api-Key": api_key, "Content-Type": "application/json"}

def listar_terminais_ws(app_id, api_key):
    """Busca terminais do tipo websocket_cloud."""
    url = f"{BASE_URL.format(app_id=app_id)}/nocServerGetTerminals"
    r = requests.post(url, headers=_headers(api_key), json={}, timeout=10)
    r.raise_for_status()
    data = r.json()
    if not data.get("success"):
        raise ValueError(f"nocServerGetTerminals erro: {data}")
    # Filtrar apenas websocket_cloud
    terminais = [t for t in data.get("terminals", []) if t.get("tipo_conexao") == "websocket_cloud"]
    return terminais

def reportar_status_ws(app_id, api_key, terminal_id, status, latencia_ms=None, segundos_sem_ping=0):
    url = f"{BASE_URL.format(app_id=app_id)}/nocServerReport"
    payload = {
        "terminal_id":       terminal_id,
        "status":            status,
        "latencia_ms":       latencia_ms,
        "segundos_sem_ping": segundos_sem_ping,
    }
    r = requests.post(url, headers=_headers(api_key), json=payload, timeout=10)
    r.raise_for_status()
    return r.json()


# ──────────────────────────────────────────────────────────────
# Handler WebSocket por terminal conectado
# ──────────────────────────────────────────────────────────────
async def handle_terminal(websocket):
    """Trata uma ligação WebSocket de um terminal Timmy."""
    peer = websocket.remote_address
    sn   = None
    logger.info(f"[WS] Nova ligação de {peer[0]}:{peer[1]}")

    try:
        async for raw_msg in websocket:
            try:
                msg = json.loads(raw_msg)
            except json.JSONDecodeError:
                logger.warning(f"[WS] Mensagem inválida de {peer[0]}: {raw_msg[:100]}")
                continue

            cmd = msg.get("cmd", "")
            msg_sn = msg.get("sn", "")

            if cmd == "reg":
                # Terminal registou-se: { cmd:"reg", sn:"ZX...", cpusn:"...", devinfo:{...} }
                sn    = msg_sn
                devinfo = msg.get("devinfo", {})
                nome  = sn_to_nome.get(sn, f"Terminal-{sn}")
                tid   = sn_to_terminal.get(sn)

                logger.info(f"[WS] REG: SN={sn} modelo={devinfo.get('modelname','?')} firmware={devinfo.get('firmware','?')}")

                if not tid:
                    logger.warning(f"[WS] SN={sn} não mapeado — adicione o número de série no painel NOC Monitor")
                    # Responder mesmo assim para não recusar o terminal
                    await websocket.send(json.dumps({
                        "ret": "reg",
                        "result": True,
                        "cloudtime": time.strftime("%Y-%m-%d %H:%M:%S"),
                        "nosenduser": True
                    }))
                    continue

                # Marcar online
                with ws_lock:
                    ws_state[sn] = {
                        "terminal_id": tid,
                        "nome": nome,
                        "connected": True,
                        "last_seen": time.time(),
                        "latencia_ms": None,
                    }

                # Responder ao terminal com a hora atual do servidor
                await websocket.send(json.dumps({
                    "ret": "reg",
                    "result": True,
                    "cloudtime": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "nosenduser": True
                }))
                logger.info(f"[WS] ✅ '{nome}' (SN={sn}) registado e ONLINE")

            elif cmd == "sendlog":
                # Terminal enviou logs de presença: heartbeat implícito
                if not sn:
                    sn = msg_sn
                count   = msg.get("count", 0)
                records = msg.get("record", [])
                logindex = msg.get("logindex", 0)

                # Actualizar estado
                if sn and sn in sn_to_terminal:
                    with ws_lock:
                        if sn in ws_state:
                            ws_state[sn]["last_seen"] = time.time()
                            ws_state[sn]["connected"] = True

                logger.info(f"[WS] SENDLOG SN={sn} count={count} logindex={logindex}")

                # Responder ao terminal
                await websocket.send(json.dumps({
                    "ret": "sendlog",
                    "result": True,
                    "count": count,
                    "logindex": logindex,
                    "cloudtime": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "access": 1
                }))

            elif cmd == "senduser":
                # Terminal enviou dados de utilizador
                if not sn: sn = msg_sn
                logger.debug(f"[WS] SENDUSER SN={sn} enrollid={msg.get('enrollid')}")
                await websocket.send(json.dumps({
                    "ret": "senduser",
                    "result": True,
                    "cloudtime": time.strftime("%Y-%m-%d %H:%M:%S")
                }))

            else:
                # Comando desconhecido — responder genérico
                logger.debug(f"[WS] CMD desconhecido: {cmd} de SN={msg_sn}")
                if "ret" not in msg:
                    await websocket.send(json.dumps({
                        "ret": cmd,
                        "result": True
                    }))

    except Exception as e:
        if "ConnectionClosed" not in type(e).__name__:
            logger.error(f"[WS] Erro com {peer[0]}: {e}")
    finally:
        if sn:
            with ws_lock:
                if sn in ws_state:
                    ws_state[sn]["connected"] = False
            logger.info(f"[WS] Ligação encerrada: SN={sn} ({peer[0]})")
        else:
            logger.info(f"[WS] Ligação encerrada: {peer[0]} (sem registo)")


# ──────────────────────────────────────────────────────────────
# Ciclo de Reporte → NOC Monitor
# ──────────────────────────────────────────────────────────────
def ciclo_reporte_ws(app_id, api_key, intervalo=30, stop_event=None):
    """Thread de reporte periódico para o NOC Monitor."""
    logger.info(f"[REPORT-WS] Ciclo de reporte activo — intervalo={intervalo}s")
    while not (stop_event and stop_event.is_set()):
        time.sleep(intervalo)
        agora = time.time()

        # Reportar todos os terminais mapeados — mesmo os que nunca se conectaram
        for sn, tid in list(sn_to_terminal.items()):
            nome = sn_to_nome.get(sn, sn)

            with ws_lock:
                estado = ws_state.get(sn)

            if estado is None:
                # Terminal nunca se ligou — reportar como offline
                try:
                    reportar_status_ws(app_id, api_key, tid, "offline", None, 0)
                    logger.info(f"[REPORT-WS] '{nome}' (SN={sn}) → OFFLINE (nunca conectou)")
                except Exception as e:
                    logger.error(f"[REPORT-WS] Erro ao reportar '{nome}': {e}")
                continue

            connected = estado.get("connected", False)
            last_seen = estado.get("last_seen", 0)
            latencia  = estado.get("latencia_ms")

            # Verificar timeout de heartbeat (sem mensagem > OFFLINE_TIMEOUT → offline)
            if connected and last_seen > 0 and (agora - last_seen) > OFFLINE_TIMEOUT:
                with ws_lock:
                    if sn in ws_state:
                        ws_state[sn]["connected"] = False
                connected = False
                logger.info(f"[REPORT-WS] '{nome}' (SN={sn}) → timeout ({OFFLINE_TIMEOUT}s) → OFFLINE")

            seg_offline = int(agora - last_seen) if not connected and last_seen > 0 else 0
            status = "online" if connected else "offline"

            try:
                reportar_status_ws(app_id, api_key, tid, status, latencia, seg_offline)
                logger.info(f"[REPORT-WS] '{nome}' (SN={sn}) → {status.upper()}"
                            + (f" offline={seg_offline}s" if seg_offline else ""))
            except Exception as e:
                logger.error(f"[REPORT-WS] Erro ao reportar '{nome}': {e}")


# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
async def main_async(app_id, api_key, ws_port, stop_event):
    async with serve(handle_terminal, "0.0.0.0", ws_port) as server:
        logger.info("=" * 65)
        logger.info(f"  Timmy WebSocket Server — NOC Monitor")
        logger.info(f"  Porta WebSocket: {ws_port}")
        logger.info(f"  Terminais mapeados: {len(sn_to_terminal)}")
        logger.info("=" * 65)
        await asyncio.get_event_loop().run_in_executor(None, stop_event.wait)
        server.close()

def run(config, stop_event=None):
    if stop_event is None:
        stop_event = threading.Event()

    app_id   = config["APP_ID"]
    api_key  = config["API_KEY"]
    ws_port  = config.get("WS_PORT", DEFAULT_WS_PORT)
    intervalo = config.get("INTERVALO_REPORT", 30)

    # Carregar terminais websocket_cloud
    global sn_to_terminal, sn_to_nome
    try:
        terminais = listar_terminais_ws(app_id, api_key)
        for t in terminais:
            sn = (t.get("numero_serie") or "").strip()
            if sn:
                sn_to_terminal[sn] = t["id"]
                sn_to_nome[sn]     = t.get("nome", sn)
                logger.info(f"  Mapeado: SN={sn} → '{t['nome']}'")
            else:
                logger.warning(f"  Terminal '{t['nome']}' sem número de série — ignorado")
        logger.info(f"Total: {len(sn_to_terminal)} terminal(is) WebSocket Cloud mapeado(s)")
    except Exception as e:
        logger.error(f"Não foi possível carregar terminais: {e}")

    # Thread de reporte
    t_report = threading.Thread(
        target=ciclo_reporte_ws,
        args=(app_id, api_key, intervalo, stop_event),
        name="ws-report", daemon=True
    )
    t_report.start()

    # Servidor WebSocket (asyncio)
    try:
        asyncio.run(main_async(app_id, api_key, ws_port, stop_event))
    except KeyboardInterrupt:
        stop_event.set()


def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            cfg = json.load(open(CONFIG_FILE, encoding="utf-8"))
            api_key = (cfg.get("API_KEY") or "").strip()
            app_id  = (cfg.get("APP_ID")  or "").strip()
            if api_key and app_id and len(api_key) >= 16:
                return cfg
        except Exception as e:
            logger.error(f"Falha ao ler config.json: {e}")
    return None


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Timmy WebSocket Server — NOC Monitor")
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--port",  type=int, default=DEFAULT_WS_PORT)
    args = parser.parse_args()
    setup_logging(args.debug)

    cfg = load_config()
    if not cfg:
        logger.error("config.json ausente ou inválido. Verifique C:\\ProgramData\\TimmyWSServer\\config.json")
        sys.exit(1)

    if args.port:
        cfg["WS_PORT"] = args.port

    sys.exit(run(cfg) or 0)
`;

const SECTIONS = [
  {
    key: 'ws',
    label: 'WebSocket Persistente',
    color: 'violet',
    badge: 'WS',
    desc: 'Terminal conecta via WebSocket e mantém ligação permanente. Heartbeat a cada 3s.',
  },
  {
    key: 'reg',
    label: 'Registo Automático',
    color: 'blue',
    badge: 'REG',
    desc: 'Terminal envia cmd:"reg" com SN, modelo e firmware ao conectar. Identificação por SN.',
  },
  {
    key: 'log',
    label: 'Logs em Tempo Real',
    color: 'emerald',
    badge: 'LOG',
    desc: 'cmd:"sendlog" — logs de presença enviados imediatamente (impressão digital, face, RFID).',
  },
];

const MODELS = [
  'TM-AI07F', 'TM-AIFace11F', 'TM-AI08', 'TFS30', 'TFS50', 'TM3800', 'TM20',
];

export default function TimmyWsServerCode() {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(TIMMY_WS_CODE);
    setCopied(true);
    toast.success('Código copiado!');
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownload = () => {
    const blob = new Blob([TIMMY_WS_CODE], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'timmy_ws_server.py';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('timmy_ws_server.py descarregado!');
  };

  return (
    <div className="space-y-4">
      {/* Modelos compatíveis */}
      <div className="p-3 bg-violet-50 border border-violet-200 rounded-lg">
        <p className="text-xs font-semibold text-violet-800 mb-2">📱 Modelos Timmy/THbio compatíveis</p>
        <div className="flex flex-wrap gap-1.5">
          {MODELS.map(m => (
            <span key={m} className="text-xs bg-violet-100 text-violet-800 px-2 py-0.5 rounded-full font-mono">{m}</span>
          ))}
          <span className="text-xs bg-violet-100 text-violet-800 px-2 py-0.5 rounded-full">e outros modelos THbio...</span>
        </div>
      </div>

      {/* Modos */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {SECTIONS.map(s => (
          <div key={s.key} className={`p-3 rounded-xl border bg-${s.color}-50 border-${s.color}-200 space-y-1`}>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-${s.color}-200 text-${s.color}-800`}>{s.badge}</span>
              <span className={`font-semibold text-sm text-${s.color}-900`}>{s.label}</span>
            </div>
            <p className={`text-xs text-${s.color}-700`}>{s.desc}</p>
          </div>
        ))}
      </div>

      {/* Config */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono space-y-0.5">
        <p className="text-slate-500 font-sans font-semibold mb-2 text-xs">📄 C:\ProgramData\TimmyWSServer\config.json</p>
        <p className="text-slate-700">{`{`}</p>
        <p className="text-slate-700 pl-4">{`"API_KEY": "a_sua_api_key_pessoal",`}</p>
        <p className="text-slate-700 pl-4">{`"APP_ID":  "697aa46c9998c30665e2e19a",`}</p>
        <p className="text-slate-700 pl-4 font-semibold text-violet-700">{`"WS_PORT": 7788,`}</p>
        <p className="text-slate-700 pl-4">{`"INTERVALO_REPORT": 30`}</p>
        <p className="text-slate-700">{`}`}</p>
      </div>

      {/* Firewall */}
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
        <p className="font-semibold">🔥 Portas a abrir no Firewall Windows</p>
        <p>• <strong>7788 TCP</strong> (ou o porto configurado em WS_PORT) — WebSocket entrada dos terminais</p>
        <p className="text-amber-700">Configure em: <em>Windows Defender Firewall → Regras de Entrada → Nova Regra → Porta TCP → 7788</em></p>
      </div>

      {/* Configuração no terminal */}
      <div className="p-3 bg-violet-50 border border-violet-200 rounded-lg text-xs text-violet-800 space-y-2">
        <p className="font-semibold">⚙️ Configuração no terminal Timmy</p>
        <p>Aceda ao terminal: <strong>MENU → Comm Set → Server</strong></p>
        <div className="font-mono bg-violet-100 px-2 py-2 rounded space-y-0.5">
          <p>Server Req: <strong>Yes</strong></p>
          <p>Use domainNm: <strong>Yes</strong> (ou No se usar IP)</p>
          <p>DomainNm: <strong>SEU_IP_OU_DOMINIO</strong></p>
          <p>SerPortNo: <strong>7788</strong></p>
          <p>Heartbeat: <strong>3s</strong></p>
          <p>Server approval: <strong>No</strong></p>
        </div>
        <p className="text-violet-700">⚠️ O <strong>número de série (SN)</strong> do terminal deve ser registado no painel NOC Monitor ao criar o terminal (campo "Número de Série"). Aceda ao SN via: <em>MENU → Sys Info → Info → SN</em></p>
      </div>

      {/* Passos instalação */}
      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 space-y-1">
        <p className="font-semibold">⚡ Instalação no Windows Server</p>
        <p>1. Python 3.9+ → <code className="bg-emerald-100 px-1 rounded">pip install websockets requests</code></p>
        <p>2. Copiar <code className="bg-emerald-100 px-1 rounded">timmy_ws_server.py</code> para <code className="bg-emerald-100 px-1 rounded">C:\Program Files\TimmyWSServer\</code></p>
        <p>3. Criar <code className="bg-emerald-100 px-1 rounded">C:\ProgramData\TimmyWSServer\config.json</code> com API_KEY, APP_ID e WS_PORT</p>
        <p>4. Instalar como serviço:</p>
        <code className="bg-emerald-100 px-2 py-1 rounded block">
          nssm install TimmyWSServer "C:\Python311\python.exe" "C:\Program Files\TimmyWSServer\timmy_ws_server.py"
        </code>
        <code className="bg-emerald-100 px-2 py-1 rounded block mt-1">
          nssm start TimmyWSServer
        </code>
      </div>

      {/* Adicionar terminal no NOC Monitor */}
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 space-y-1">
        <p className="font-semibold">📋 Como adicionar um terminal Timmy no NOC Monitor</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Ir a <strong>Terminais → Adicionar Terminal</strong></li>
          <li>Seleccionar <strong>Fabricante: Timmy</strong></li>
          <li>Seleccionar <strong>Tipo de Conexão: WebSocket Cloud</strong></li>
          <li>Inserir o <strong>Número de Série (SN)</strong> do terminal</li>
          <li>Reiniciar o <code className="bg-blue-100 px-1 rounded">timmy_ws_server.py</code> para carregar o novo terminal</li>
        </ol>
      </div>

      {/* Botões download */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Server className="h-4 w-4 text-slate-500" />
          timmy_ws_server.py — Servidor WebSocket Cloud
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
        <pre className="bg-slate-900 text-emerald-400 p-4 rounded-lg text-xs overflow-x-auto max-h-[600px] overflow-y-auto font-mono leading-relaxed whitespace-pre">
          {TIMMY_WS_CODE}
        </pre>
      )}
    </div>
  );
}