import React, { useState } from 'react';
import { Copy, Check, Download, Server, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const MBIO_WS_CODE = `# mbio_ws_server.py — NOC Monitor: Servidor WebSocket Cloud (Protocolo M-BioFace)
# Compatível com: M-BioFace v4, M-BioFace v3, e outros modelos M-Bio com WebSocket
# Protocolo: WebSocket + JSON — porta padrão 7600 (configurável)
#
# Funcionalidades:
#   - AutoSyncEmployees: sincronização automática de funcionários
#   - SendFacePhoto / SendFingerprint: recepção de biometria
#   - LiveTimeSync: sincronização de hora em tempo real
#   - UseCartaoAsEnrollId: número de cartão como ID de matrícula
#   - Suporte a range de portas (multi-terminal)
#
# Config: C:\\ProgramData\\MbioWSServer\\config.json
# {
#   "API_KEY": "a_sua_api_key_pessoal",
#   "APP_ID":  "697aa46c9998c30665e2e19a",
#   "WS_PORT": 7600,
#   "ModelFilter": "M-BioFacev4",
#   "UseCartaoAsEnrollId": true,
#   "SendFacePhoto": true,
#   "SendFingerprint": true,
#   "AutoSyncEmployees": true,
#   "AutoSyncIntervalSeconds": 60,
#   "LiveTimeSync": true,
#   "LiveTimeSyncIntervalSeconds": 30,
#   "TimeOffsetSeconds": 0,
#   "Access": 1
# }
#
# Instalação (Windows):
#   pip install websockets requests
#   nssm install MbioWSServer "C:\\Python311\\python.exe" "C:\\Program Files\\MbioWSServer\\mbio_ws_server.py"
#   nssm start MbioWSServer

import os, sys, json, time, logging, asyncio, threading, uuid
from logging.handlers import RotatingFileHandler
from http.server import HTTPServer, BaseHTTPRequestHandler
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
APP_DIR      = os.path.join(PROGRAMDATA, "MbioWSServer")
CONFIG_FILE  = os.path.join(APP_DIR, "config.json")
LOG_FILE     = os.path.join(APP_DIR, "mbio_ws.log")

DEFAULT_WS_PORT     = 7600
DEFAULT_CTRL_PORT   = 7601
OFFLINE_TIMEOUT     = 60    # segundos sem mensagem → offline
RECONNECT_GRACE     = 30    # grace period antes de reportar offline
BASE_URL = "https://app.base44.app/api/apps/{app_id}/functions"

logger = logging.getLogger("mbio_ws")

# Estado em memória: SN → { terminal_id, nome, last_seen, latencia_ms, connected, disconnected_at }
ws_state     = {}
ws_lock      = threading.Lock()
sn_to_terminal = {}
sn_to_nome     = {}
ws_connections = {}
ws_conn_lock   = threading.Lock()
pending_commands = {}
pending_lock     = threading.Lock()

# Config global (carregada no arranque)
CFG = {}


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

def listar_terminais_mbio(app_id, api_key):
    """Busca terminais M-Bio com tipo websocket_cloud."""
    url = f"{BASE_URL.format(app_id=app_id)}/nocServerGetTerminals"
    r = requests.post(url, headers=_headers(api_key), json={}, timeout=10)
    r.raise_for_status()
    data = r.json()
    if not data.get("success"):
        raise ValueError(f"nocServerGetTerminals erro: {data}")
    terminais = [
        t for t in data.get("terminals", [])
        if t.get("tipo_conexao") == "websocket_cloud"
        and t.get("fabricante", "").lower() in ("mbio", "m-bio", "m_bio")
    ]
    return terminais

def reportar_status(app_id, api_key, terminal_id, status, latencia_ms=None, segundos_sem_ping=0):
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
# Sincronização de Hora (LiveTimeSync)
# ──────────────────────────────────────────────────────────────
def get_server_time():
    offset = int(CFG.get("TimeOffsetSeconds", 0))
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() + offset))

async def send_time_sync(websocket, sn):
    """Envia sincronização de hora ao terminal."""
    await websocket.send(json.dumps({
        "cmd": "settime",
        "time": get_server_time()
    }))
    logger.debug(f"[TIME-SYNC] Hora enviada a SN={sn}: {get_server_time()}")


# ──────────────────────────────────────────────────────────────
# Handler WebSocket por terminal conectado
# ──────────────────────────────────────────────────────────────
async def handle_terminal(websocket):
    """Trata uma ligação WebSocket de um terminal M-BioFace."""
    peer = websocket.remote_address
    sn   = None
    logger.info(f"[WS] Nova ligação M-BioFace de {peer[0]}:{peer[1]}")

    try:
        async for raw_msg in websocket:
            try:
                msg = json.loads(raw_msg)
            except json.JSONDecodeError:
                logger.warning(f"[WS] Mensagem inválida de {peer[0]}: {raw_msg[:100]}")
                continue

            cmd    = msg.get("cmd", "")
            msg_sn = msg.get("sn", "") or msg.get("serialNumber", "")

            # ── Registo inicial ──
            if cmd in ("reg", "register", "hello"):
                sn      = msg_sn or msg.get("deviceSN", "")
                devinfo = msg.get("devinfo", msg.get("deviceInfo", {}))
                nome    = sn_to_nome.get(sn, f"MBio-{sn}")
                tid     = sn_to_terminal.get(sn)

                model   = devinfo.get("modelname", devinfo.get("model", CFG.get("ModelFilter", "M-BioFace")))
                fw      = devinfo.get("firmware", devinfo.get("version", "?"))
                logger.info(f"[WS] REG M-BioFace: SN={sn} modelo={model} fw={fw}")

                if not tid:
                    logger.warning(f"[WS] SN={sn} não mapeado — adicione no painel com fabricante M-Bio")
                    await websocket.send(json.dumps({
                        "ret": cmd, "result": True,
                        "cloudtime": get_server_time(),
                        "nosenduser": CFG.get("Nosenduser", True),
                        "access": CFG.get("Access", 1)
                    }))
                    continue

                with ws_conn_lock:
                    ws_connections[sn] = (websocket, asyncio.get_event_loop())

                with ws_lock:
                    ws_state[sn] = {
                        "terminal_id": tid, "nome": nome,
                        "connected": True, "last_seen": time.time(),
                        "latencia_ms": None, "disconnected_at": None,
                    }

                resp = {
                    "ret": cmd, "result": True,
                    "cloudtime": get_server_time(),
                    "nosenduser": CFG.get("Nosenduser", True),
                    "access": CFG.get("Access", 1)
                }
                await websocket.send(json.dumps(resp))
                logger.info(f"[WS] ✅ M-BioFace '{nome}' (SN={sn}) ONLINE")

                # LiveTimeSync na conexão
                if CFG.get("LiveTimeSync", True):
                    await send_time_sync(websocket, sn)

            # ── Logs de presença / heartbeat ──
            elif cmd in ("sendlog", "attendance", "record"):
                if not sn: sn = msg_sn
                count    = msg.get("count", 0)
                logindex = msg.get("logindex", 0)
                records  = msg.get("record", msg.get("records", []))

                if sn and sn in sn_to_terminal:
                    with ws_lock:
                        if sn in ws_state:
                            ws_state[sn]["last_seen"]      = time.time()
                            ws_state[sn]["connected"]      = True
                            ws_state[sn]["disconnected_at"] = None

                for rec in records:
                    enroll_id = rec.get("enrollid", rec.get("enrollId", ""))
                    verify    = rec.get("verifymode", rec.get("verifyMode", ""))
                    ts        = rec.get("time", rec.get("timestamp", ""))
                    has_photo = bool(rec.get("photo") or rec.get("faceImage"))
                    has_fp    = bool(rec.get("fingerprint") or rec.get("fpData"))
                    logger.info(f"[LOG] SN={sn} enrollid={enroll_id} mode={verify} ts={ts}"
                                + (" [PHOTO]" if has_photo else "")
                                + (" [FP]" if has_fp else ""))

                await websocket.send(json.dumps({
                    "ret": cmd, "result": True, "count": count,
                    "logindex": logindex, "cloudtime": get_server_time(),
                    "access": CFG.get("Access", 1)
                }))

            # ── Envio de utilizadores (AutoSyncEmployees) ──
            elif cmd in ("senduser", "userSync", "enrollSync"):
                if not sn: sn = msg_sn
                enroll_id = msg.get("enrollid", msg.get("enrollId", ""))
                use_cartao = CFG.get("UseCartaoAsEnrollId", True)
                logger.debug(f"[WS] SENDUSER SN={sn} enrollid={enroll_id} use_cartao={use_cartao}")
                await websocket.send(json.dumps({
                    "ret": cmd, "result": True, "cloudtime": get_server_time()
                }))

            # ── Foto facial recebida ──
            elif cmd in ("sendface", "faceData", "facePhoto"):
                if not sn: sn = msg_sn
                if CFG.get("SendFacePhoto", True):
                    logger.info(f"[BIOMETRIA] Foto facial recebida de SN={sn}")
                await websocket.send(json.dumps({
                    "ret": cmd, "result": True, "cloudtime": get_server_time()
                }))

            # ── Impressão digital recebida ──
            elif cmd in ("sendfinger", "fpData", "fingerprint"):
                if not sn: sn = msg_sn
                if CFG.get("SendFingerprint", True):
                    logger.info(f"[BIOMETRIA] Impressão digital recebida de SN={sn}")
                await websocket.send(json.dumps({
                    "ret": cmd, "result": True, "cloudtime": get_server_time()
                }))

            # ── Heartbeat explícito ──
            elif cmd in ("heartbeat", "ping", "keepalive"):
                if not sn: sn = msg_sn
                if sn and sn in sn_to_terminal:
                    with ws_lock:
                        if sn in ws_state:
                            ws_state[sn]["last_seen"]      = time.time()
                            ws_state[sn]["connected"]      = True
                            ws_state[sn]["disconnected_at"] = None
                await websocket.send(json.dumps({
                    "ret": cmd, "result": True, "cloudtime": get_server_time()
                }))

            # ── Resposta a comandos enviados pelo NOC Monitor ──
            elif msg.get("ret"):
                ret_cmd     = msg.get("ret")
                terminal_sn = sn or msg_sn
                with pending_lock:
                    key = (terminal_sn, ret_cmd)
                    if key in pending_commands:
                        future = pending_commands.pop(key)
                        if not future.done():
                            future.set_result(msg)
                        logger.debug(f"[WS] Resposta '{ret_cmd}' de SN={terminal_sn}: result={msg.get('result')}")

            else:
                logger.debug(f"[WS] CMD desconhecido M-BioFace: {msg}")
                if "ret" not in msg and cmd:
                    await websocket.send(json.dumps({"ret": cmd, "result": True}))

    except Exception as e:
        if "ConnectionClosed" not in type(e).__name__:
            logger.error(f"[WS] Erro M-BioFace {peer[0]}: {e}")
    finally:
        if sn:
            with ws_conn_lock:
                if ws_connections.get(sn, (None,))[0] is websocket:
                    del ws_connections[sn]
            with ws_lock:
                if sn in ws_state:
                    ws_state[sn]["connected"]      = False
                    ws_state[sn]["disconnected_at"] = time.time()
            logger.info(f"[WS] Ligação encerrada M-BioFace: SN={sn} — grace {RECONNECT_GRACE}s")
        else:
            logger.info(f"[WS] Ligação encerrada M-BioFace: {peer[0]} (sem registo)")


# ──────────────────────────────────────────────────────────────
# LiveTimeSync periódico
# ──────────────────────────────────────────────────────────────
async def live_time_sync_loop(interval_seconds, stop_event):
    """Envia sincronização de hora a todos os terminais conectados periodicamente."""
    logger.info(f"[TIME-SYNC] LiveTimeSync activo — intervalo={interval_seconds}s")
    while not stop_event.is_set():
        await asyncio.sleep(interval_seconds)
        with ws_conn_lock:
            conns = list(ws_connections.items())
        for sn, (ws, _) in conns:
            try:
                await send_time_sync(ws, sn)
            except Exception as e:
                logger.debug(f"[TIME-SYNC] Erro ao sincronizar hora com SN={sn}: {e}")


# ──────────────────────────────────────────────────────────────
# Servidor HTTP de Controlo
# ──────────────────────────────────────────────────────────────
class CtrlHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): pass

    def do_POST(self):
        if self.path != "/cmd":
            self.send_response(404); self.end_headers(); return

        length  = int(self.headers.get("Content-Length", 0) or 0)
        body    = self.rfile.read(length)
        try:
            payload = json.loads(body)
        except Exception:
            self._respond(400, {"success": False, "error": "JSON inválido"}); return

        sn      = (payload.get("sn") or "").strip()
        command = payload.get("command")
        if not sn or not command:
            self._respond(400, {"success": False, "error": "sn e command obrigatórios"}); return

        with ws_conn_lock:
            conn_data = ws_connections.get(sn)
        if not conn_data:
            self._respond(503, {"success": False, "error": f"SN={sn} não conectado"}); return

        ws, loop = conn_data
        try:
            future = asyncio.run_coroutine_threadsafe(
                self._send_and_wait(ws, sn, command), loop
            )
            result = future.result(timeout=12)
            self._respond(200, {"success": True, "result": result})
        except asyncio.TimeoutError:
            self._respond(504, {"success": False, "error": "Terminal não respondeu em 12s"})
        except Exception as e:
            self._respond(500, {"success": False, "error": str(e)})

    FIRE_AND_FORGET_CMDS = {"settime", "reboot", "sync"}

    async def _send_and_wait(self, ws, sn, command):
        cmd_name = command.get("cmd", "")
        if cmd_name in self.FIRE_AND_FORGET_CMDS:
            await ws.send(json.dumps(command))
            return {"result": True, "note": "Comando enviado (sem confirmação)"}
        loop   = asyncio.get_event_loop()
        future = loop.create_future()
        with pending_lock:
            pending_commands[(sn, cmd_name)] = future
        try:
            await ws.send(json.dumps(command))
            return await asyncio.wait_for(future, timeout=11)
        finally:
            with pending_lock:
                pending_commands.pop((sn, cmd_name), None)

    def do_GET(self):
        if self.path == "/status":
            with ws_conn_lock:
                sns = list(ws_connections.keys())
            self._respond(200, {"connected_terminals": sns, "count": len(sns)})
        else:
            self.send_response(404); self.end_headers()

    def _respond(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)


def start_ctrl_server(port, stop_event):
    try:
        server = HTTPServer(("0.0.0.0", port), CtrlHandler)
        server.timeout = 1
        logger.info(f"[CTRL] HTTP controlo activo em http://0.0.0.0:{port}/cmd")
        while not stop_event.is_set():
            server.handle_request()
        server.server_close()
    except Exception as e:
        logger.error(f"[CTRL] Erro: {e}")


# ──────────────────────────────────────────────────────────────
# Ciclo de Reporte
# ──────────────────────────────────────────────────────────────
def ciclo_reporte(app_id, api_key, intervalo=30, stop_event=None):
    logger.info(f"[REPORT] Ciclo activo — intervalo={intervalo}s")
    while not (stop_event and stop_event.is_set()):
        time.sleep(intervalo)
        with ws_lock:
            snapshot = dict(ws_state)

        for sn, estado in snapshot.items():
            tid             = estado.get("terminal_id")
            nome            = estado.get("nome", sn)
            connected       = estado.get("connected", False)
            last_seen       = estado.get("last_seen", 0)
            latencia        = estado.get("latencia_ms")
            disconnected_at = estado.get("disconnected_at")

            if not tid: continue

            if connected and last_seen > 0 and (time.time() - last_seen) > OFFLINE_TIMEOUT:
                with ws_lock:
                    if sn in ws_state:
                        ws_state[sn]["connected"]      = False
                        ws_state[sn]["disconnected_at"] = time.time()
                connected       = False
                disconnected_at = time.time()

            if not connected and disconnected_at and (time.time() - disconnected_at) < RECONNECT_GRACE:
                logger.debug(f"[REPORT] '{nome}' em grace period...")
                continue

            seg_offline = int(time.time() - last_seen) if not connected and last_seen > 0 else 0
            status      = "online" if connected else "offline"

            try:
                reportar_status(app_id, api_key, tid, status, latencia, seg_offline)
                logger.info(f"[REPORT] '{nome}' (SN={sn}) → {status.upper()}"
                            + (f" offline={seg_offline}s" if seg_offline else ""))
            except Exception as e:
                logger.error(f"[REPORT] Erro ao reportar '{nome}': {e}")


# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
async def main_async(app_id, api_key, ws_port, stop_event, live_sync_interval):
    tasks = []
    if CFG.get("LiveTimeSync", True) and live_sync_interval > 0:
        tasks.append(asyncio.create_task(
            live_time_sync_loop(live_sync_interval, stop_event)
        ))
    async with serve(handle_terminal, "0.0.0.0", ws_port) as server:
        logger.info("=" * 65)
        logger.info(f"  M-BioFace WebSocket Server — NOC Monitor")
        logger.info(f"  Porta WebSocket (terminais): {ws_port}")
        logger.info(f"  Porta HTTP controlo (NOC Monitor): {ws_port + 1}")
        logger.info(f"  ModelFilter: {CFG.get('ModelFilter','M-BioFacev4')}")
        logger.info(f"  AutoSyncEmployees: {CFG.get('AutoSyncEmployees', True)}")
        logger.info(f"  LiveTimeSync: {CFG.get('LiveTimeSync', True)} ({live_sync_interval}s)")
        logger.info(f"  Terminais mapeados: {len(sn_to_terminal)}")
        logger.info("=" * 65)
        await asyncio.get_event_loop().run_in_executor(None, stop_event.wait)
        for t in tasks: t.cancel()
        server.close()

def run(config, stop_event=None):
    global CFG, sn_to_terminal, sn_to_nome
    CFG = config

    if stop_event is None:
        stop_event = threading.Event()

    app_id     = config["APP_ID"]
    api_key    = config["API_KEY"]
    ws_port    = config.get("WS_PORT", DEFAULT_WS_PORT)
    ctrl_port  = config.get("CTRL_PORT", DEFAULT_CTRL_PORT)
    intervalo  = config.get("INTERVALO_REPORT", 30)
    sync_int   = config.get("LiveTimeSyncIntervalSeconds", 30)

    try:
        terminais = listar_terminais_mbio(app_id, api_key)
        for t in terminais:
            sn = (t.get("numero_serie") or "").strip()
            if sn:
                sn_to_terminal[sn] = t["id"]
                sn_to_nome[sn]     = t.get("nome", sn)
                logger.info(f"  Mapeado M-BioFace: SN={sn} → '{t['nome']}'")
            else:
                logger.warning(f"  Terminal '{t['nome']}' sem SN — ignorado")
        logger.info(f"Total: {len(sn_to_terminal)} terminal(is) M-BioFace mapeado(s)")
    except Exception as e:
        logger.error(f"Não foi possível carregar terminais: {e}")

    threading.Thread(
        target=ciclo_reporte,
        args=(app_id, api_key, intervalo, stop_event),
        name="mbio-report", daemon=True
    ).start()

    threading.Thread(
        target=start_ctrl_server,
        args=(ctrl_port, stop_event),
        name="ctrl-http", daemon=True
    ).start()

    try:
        asyncio.run(main_async(app_id, api_key, ws_port, stop_event, sync_int))
    except KeyboardInterrupt:
        stop_event.set()


def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            cfg     = json.load(open(CONFIG_FILE, encoding="utf-8"))
            api_key = (cfg.get("API_KEY") or "").strip()
            app_id  = (cfg.get("APP_ID")  or "").strip()
            if api_key and app_id and len(api_key) >= 16:
                return cfg
        except Exception as e:
            logger.error(f"Falha ao ler config.json: {e}")
    return None


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="M-BioFace WebSocket Server — NOC Monitor")
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--port",  type=int, default=DEFAULT_WS_PORT)
    args = parser.parse_args()
    setup_logging(args.debug)

    cfg = load_config()
    if not cfg:
        logger.error("config.json ausente ou inválido. Verifique C:\\ProgramData\\MbioWSServer\\config.json")
        sys.exit(1)

    if args.port:
        cfg["WS_PORT"] = args.port

    sys.exit(run(cfg) or 0)
`;

const SECTIONS = [
  {
    key: 'biometria',
    label: 'Biometria Completa',
    color: 'rose',
    badge: 'BIO',
    desc: 'Suporte a foto facial (SendFacePhoto) e impressão digital (SendFingerprint) em tempo real.',
  },
  {
    key: 'sync',
    label: 'AutoSync Funcionários',
    color: 'blue',
    badge: 'SYNC',
    desc: 'Sincronização automática de funcionários a cada 60s (configurável). UseCartaoAsEnrollId.',
  },
  {
    key: 'timesync',
    label: 'LiveTimeSync',
    color: 'emerald',
    badge: 'TIME',
    desc: 'Sincronização de hora em tempo real a cada 30s. TimeOffsetSeconds configurável.',
  },
];

const MODELS = ['M-BioFace v4', 'M-BioFace v3', 'M-BioFace Pro', 'M-Bio Access'];

export default function MbioWsServerCode() {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(MBIO_WS_CODE);
    setCopied(true);
    toast.success('Código copiado!');
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownload = () => {
    const blob = new Blob([MBIO_WS_CODE], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'mbio_ws_server.py';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('mbio_ws_server.py descarregado!');
  };

  return (
    <div className="space-y-4">
      {/* Modelos compatíveis */}
      <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg">
        <p className="text-xs font-semibold text-rose-800 mb-2">📱 Modelos M-BioFace compatíveis</p>
        <div className="flex flex-wrap gap-1.5">
          {MODELS.map(m => (
            <span key={m} className="text-xs bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full font-mono">{m}</span>
          ))}
          <span className="text-xs bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full">e outros modelos M-Bio WebSocket...</span>
        </div>
      </div>

      {/* Funcionalidades */}
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
        <p className="text-slate-500 font-sans font-semibold mb-2 text-xs">📄 C:\ProgramData\MbioWSServer\config.json</p>
        <p className="text-slate-700">{`{`}</p>
        <p className="text-slate-700 pl-4">{`"API_KEY": "a_sua_api_key_pessoal",`}</p>
        <p className="text-slate-700 pl-4">{`"APP_ID":  "697aa46c9998c30665e2e19a",`}</p>
        <p className="text-rose-700 pl-4 font-semibold">{`"WS_PORT": 7600,`}</p>
        <p className="text-slate-700 pl-4">{`"ModelFilter": "M-BioFacev4",`}</p>
        <p className="text-blue-700 pl-4">{`"UseCartaoAsEnrollId": true,`}</p>
        <p className="text-blue-700 pl-4">{`"SendFacePhoto": true,`}</p>
        <p className="text-blue-700 pl-4">{`"SendFingerprint": true,`}</p>
        <p className="text-emerald-700 pl-4">{`"AutoSyncEmployees": true,`}</p>
        <p className="text-emerald-700 pl-4">{`"AutoSyncIntervalSeconds": 60,`}</p>
        <p className="text-emerald-700 pl-4">{`"LiveTimeSync": true,`}</p>
        <p className="text-emerald-700 pl-4">{`"LiveTimeSyncIntervalSeconds": 30,`}</p>
        <p className="text-slate-700 pl-4">{`"TimeOffsetSeconds": 0,`}</p>
        <p className="text-slate-700 pl-4">{`"Access": 1`}</p>
        <p className="text-slate-700">{`}`}</p>
      </div>

      {/* Firewall */}
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
        <p className="font-semibold">🔥 Portas a abrir no Firewall Windows</p>
        <p>• <strong>7600 TCP</strong> — WebSocket entrada dos terminais M-BioFace (WS_PORT)</p>
        <p>• <strong>7601 TCP</strong> — HTTP controlo remoto NOC Monitor (CTRL_PORT)</p>
        <p className="text-amber-700">Configure em: <em>Windows Defender Firewall → Regras de Entrada → Nova Regra → Porta TCP → 7600, 7601</em></p>
      </div>

      {/* Como adicionar terminal */}
      <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 space-y-2">
        <p className="font-semibold">⚙️ Como adicionar um terminal M-BioFace no NOC Monitor</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Ir a <strong>Terminais → Adicionar Terminal</strong></li>
          <li>Seleccionar <strong>Fabricante: M-Bio</strong></li>
          <li>Seleccionar <strong>Tipo de Conexão: WebSocket Cloud</strong></li>
          <li>Inserir o <strong>Número de Série (SN)</strong> do terminal</li>
          <li>Reiniciar o <code className="bg-rose-100 px-1 rounded">mbio_ws_server.py</code> para carregar o novo terminal</li>
        </ol>
      </div>

      {/* Instalação */}
      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 space-y-1">
        <p className="font-semibold">⚡ Instalação no Windows Server</p>
        <p>1. Python 3.9+ → <code className="bg-emerald-100 px-1 rounded">pip install websockets requests</code></p>
        <p>2. Copiar <code className="bg-emerald-100 px-1 rounded">mbio_ws_server.py</code> para <code className="bg-emerald-100 px-1 rounded">C:\Program Files\MbioWSServer\</code></p>
        <p>3. Criar <code className="bg-emerald-100 px-1 rounded">C:\ProgramData\MbioWSServer\config.json</code></p>
        <p>4. Instalar como serviço:</p>
        <code className="bg-emerald-100 px-2 py-1 rounded block">
          nssm install MbioWSServer "C:\Python311\python.exe" "C:\Program Files\MbioWSServer\mbio_ws_server.py"
        </code>
        <code className="bg-emerald-100 px-2 py-1 rounded block mt-1">
          nssm start MbioWSServer
        </code>
      </div>

      {/* Botões */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Server className="h-4 w-4 text-slate-500" />
          mbio_ws_server.py — Servidor WebSocket M-BioFace
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
          {MBIO_WS_CODE}
        </pre>
      )}
    </div>
  );
}