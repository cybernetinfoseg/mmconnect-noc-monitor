import React, { useState } from 'react';
import { Copy, Check, Download, Server, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

const NOC_SERVER_CODE = `# noc_server.py — NOC Monitor Windows Server
# Servidor unificado para terminais biométricos (Heartbeat TCP + ADMS/Push HTTP + SDK-TCP)
# IP do servidor: 127.0.0.1
#
# Suporta terminais:
#   - Heartbeat TCP: terminal conecta via TCP — online se conectar, offline no timeout
#   - ADMS/Push (ZKTeco ADMS): terminal faz HTTP POST /iclock/cdata para reportar presença
#   - SDK-TCP (ZKTeco SDK): polling TCP na porta 4370 do terminal
#
# Requisitos:
#   pip install requests
#
# Config: C:\\ProgramData\\NOCMonitor\\config.json
# {
#   "API_KEY": "a_sua_api_key_pessoal",
#   "APP_ID":  "697aa46c9998c30665e2e19a",
#   "INTERVALO_REPORT": 30,
#   "ADMS_PORT": 8080
# }
#
# Como Servico Windows (NSSM):
#   nssm install NOCMonitor "C:\\Python311\\python.exe" "C:\\Program Files\\NOCMonitor\\noc_server.py"
#   nssm set NOCMonitor AppDirectory "C:\\Program Files\\NOCMonitor"
#   nssm start NOCMonitor
#
# Portas a abrir no Firewall Windows:
#   - Porta ADMS_PORT (default 8080): terminais ADMS/Push (ZKTeco, Anviz)
#   - Portas individuais dos terminais Heartbeat (ex: 5005, 5006, 5007...)

import os, sys, json, time, socket, logging, threading
from logging.handlers import RotatingFileHandler
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import requests

# ──────────────────────────────────────────────────────────────
# Paths e Constantes
# ──────────────────────────────────────────────────────────────
PROGRAMDATA  = os.environ.get("PROGRAMDATA", r"C:\\ProgramData")
APP_DIR      = os.path.join(PROGRAMDATA, "NOCMonitor")
CONFIG_FILE  = os.path.join(APP_DIR, "config.json")
LOG_FILE     = os.path.join(APP_DIR, "noc_server.log")
LOCK_FILE    = os.path.join(APP_DIR, "noc_server.lock")

DEFAULT_INTERVAL       = 30    # segundos entre ciclos de reporte
ACCEPT_TIMEOUT         = 25    # timeout TCP para terminais Heartbeat
SDK_TCP_TIMEOUT        = 5     # timeout para testar porta SDK (4370)
DEFAULT_ADMS_PORT      = 8080  # porta HTTP para recepcao ADMS/Push
RELOAD_INTERVAL        = 300   # segundos entre recargas automáticas de terminais (5 min)
BASE_URL = "https://app.base44.app/api/apps/{app_id}/functions"

logger = logging.getLogger("noc_server")

# Estado em memória para cada terminal
# { terminal_id: { "connected": bool, "last_seen": float, "latencia_ms": int|None, "tipo": str } }
state      = {}
state_lock = threading.Lock()

# Controlo de threads activas por terminal_id (para evitar duplicados na recarga)
active_threads = {}
active_threads_lock = threading.Lock()


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
# Instância única (evitar dupla execução)
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
# API Helpers
# ──────────────────────────────────────────────────────────────
def _headers(api_key):
    return {"X-Api-Key": api_key, "Content-Type": "application/json"}

def listar_terminais(session, app_id, api_key):
    """Busca todos os terminais do utilizador (todos os tipos suportados pelo servidor)."""
    # Busca terminais heartbeat + adms_push + sdk_tcp
    url = f"{BASE_URL.format(app_id=app_id)}/nocServerGetTerminals"
    r   = session.post(url, headers=_headers(api_key), json={}, timeout=10)
    r.raise_for_status()
    data = r.json()
    if not data.get("success"):
        raise ValueError(f"nocServerGetTerminals erro: {data}")
    return data.get("terminals", [])

def reportar_status(session, app_id, api_key, terminal_id, status, latencia_ms=None, segundos_sem_ping=0):
    url = f"{BASE_URL.format(app_id=app_id)}/nocServerReport"
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
# MODO 1: Heartbeat TCP — thread por terminal/porta
# Terminal → conecta TCP → servidor regista como online
# ──────────────────────────────────────────────────────────────
def heartbeat_listener(terminal, stop_event):
    tid   = terminal["id"]
    nome  = terminal.get("nome", tid)
    porta = int(terminal.get("porta", 5005))

    with state_lock:
        state[tid] = {"connected": False, "last_seen": 0, "latencia_ms": None, "tipo": "heartbeat"}

    logger.info(f"[HB-TCP] Iniciando escuta para '{nome}' na porta :{porta}")
    srv_sock = None

    while not stop_event.is_set():
        try:
            if srv_sock is None:
                srv_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                srv_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                srv_sock.bind(("0.0.0.0", porta))
                srv_sock.listen(10)
                srv_sock.settimeout(ACCEPT_TIMEOUT)

            try:
                t0 = time.time()
                conn, addr = srv_sock.accept()
                latencia = int((time.time() - t0) * 1000)
                conn.close()
                with state_lock:
                    state[tid] = {"connected": True, "last_seen": time.time(), "latencia_ms": latencia, "tipo": "heartbeat"}
                logger.info(f"[HB-TCP] '{nome}' :{porta} <- {addr[0]} ONLINE (lat={latencia}ms)")
            except socket.timeout:
                with state_lock:
                    state[tid]["connected"] = False
                logger.debug(f"[HB-TCP] '{nome}' :{porta} timeout → OFFLINE")

        except OSError as e:
            logger.error(f"[HB-TCP] Erro socket '{nome}' :{porta} — {e}")
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
    logger.info(f"[HB-TCP] Thread '{nome}' :{porta} encerrada.")


# ──────────────────────────────────────────────────────────────
# MODO 2: ADMS/Push (ZKTeco ADMS) — servidor HTTP central
# Terminal → POST /iclock/cdata → servidor regista como online
# Compatível com: ZKTeco (iClock, ZKTime, SilkBio), Anviz (C2, EP, CrossChex)
# ──────────────────────────────────────────────────────────────

# Mapa: SN (número de série) → terminal_id
sn_to_terminal = {}

class ADMSHandler(BaseHTTPRequestHandler):
    """
    Servidor ADMS (Automatic Data Master Server) compatível com protocolo ZKTeco.
    Recebe posts HTTP dos terminais (mesmo protocolo que o ZKTeco BioTime/iClocknet).
    """
    def log_message(self, fmt, *args):
        pass  # Silenciar logs HTTP internos

    def do_GET(self):
        parsed = urlparse(self.path)
        path   = parsed.path

        if path == "/iclock/getrequest":
            # Terminal solicita comandos pendentes — responder OK (sem comandos)
            sn = parse_qs(parsed.query).get("SN", [""])[0]
            if sn:
                self._mark_online_by_sn(sn, latencia_ms=None)
                logger.debug(f"[ADMS] Terminal SN={sn} polling getrequest")
            self._respond("OK")

        elif path == "/iclock/ping" or path == "/ping":
            # Alguns terminais fazem GET /ping para verificar conectividade
            sn = parse_qs(parsed.query).get("SN", [""])[0]
            if sn: self._mark_online_by_sn(sn)
            self._respond("OK")

        elif path == "/status":
            # Endpoint de diagnóstico — mostra estado atual
            with state_lock:
                data = {tid: {"connected": s["connected"], "tipo": s.get("tipo","?")} for tid, s in state.items()}
            body = json.dumps({"terminals": data, "sn_map": sn_to_terminal}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", len(body))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        parsed  = urlparse(self.path)
        path    = parsed.path
        params  = parse_qs(parsed.query)
        sn      = params.get("SN", [""])[0]
        table   = params.get("table", [""])[0]
        command = params.get("c", [""])[0]
        length  = int(self.headers.get("Content-Length", 0) or 0)
        body    = self.rfile.read(length).decode("utf-8", errors="ignore") if length > 0 else ""

        if path in ("/iclock/cdata", "/cdata"):
            if sn:
                self._mark_online_by_sn(sn)
                logger.info(f"[ADMS] SN={sn} table={table} c={command} body_len={len(body)}")

            # Registo inicial do terminal
            if table == "options" and command == "registry":
                logger.info(f"[ADMS] ✅ Terminal SN={sn} registou-se no servidor ADMS")
                self._respond("OK")

            # Logs de assiduidade
            elif table == "ATTLOG" and body:
                logger.info(f"[ADMS] 📋 Logs de assiduidade do SN={sn}: {len(body.splitlines())} registo(s)")
                self._respond("OK")

            # Dados de utilizadores
            elif table == "USER" and body:
                logger.info(f"[ADMS] 👤 Dados de utilizador do SN={sn}: {len(body.splitlines())} registo(s)")
                self._respond("OK")

            # Fotos/templates
            elif table == "PHOTO":
                logger.debug(f"[ADMS] 📷 Foto do SN={sn}")
                self._respond("OK")

            # Heartbeat/keepalive
            else:
                self._respond("OK")

        else:
            self._respond("OK")

    def _respond(self, text):
        body = text.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def _mark_online_by_sn(self, sn, latencia_ms=None):
        """Marca terminal com este SN como online."""
        tid = sn_to_terminal.get(sn)
        if tid:
            with state_lock:
                state[tid] = {
                    "connected":   True,
                    "last_seen":   time.time(),
                    "latencia_ms": latencia_ms,
                    "tipo":        "adms_push",
                }
        else:
            logger.warning(f"[ADMS] SN={sn} não está mapeado a nenhum terminal. Adicione o número de série no painel.")


def start_adms_server(port, stop_event):
    """Inicia o servidor HTTP ADMS numa thread dedicada."""
    try:
        server = HTTPServer(("0.0.0.0", port), ADMSHandler)
        server.timeout = 1
        logger.info(f"[ADMS] Servidor HTTP activo em http://0.0.0.0:{port}/iclock/cdata")
        logger.info(f"[ADMS] Configure os terminais ZKTeco com: Servidor = http://127.0.0.1:{port}")
        while not stop_event.is_set():
            server.handle_request()
        server.server_close()
    except Exception as e:
        logger.error(f"[ADMS] Erro no servidor HTTP: {e}")


# ──────────────────────────────────────────────────────────────
# MODO 3: SDK-TCP — polling activo na porta 4370 do terminal
# Servidor → testa TCP na porta 4370 do terminal → online/offline
# Compatível com: ZKTeco (porta 4370 padrão do SDK ZKAccess3.5)
# ──────────────────────────────────────────────────────────────
def sdk_tcp_poller(terminal, stop_event, intervalo=30):
    """
    Testa periodicamente a conectividade TCP na porta 4370 (porta padrão ZKTeco SDK).
    Funciona para terminais acessíveis diretamente via IP público ou rede local.
    """
    tid   = terminal["id"]
    nome  = terminal.get("nome", tid)
    host  = terminal.get("ip_publico") or terminal.get("ip_local") or terminal.get("dns")
    porta = int(terminal.get("porta") or 4370)

    if not host:
        logger.error(f"[SDK-TCP] '{nome}': sem IP/DNS configurado. Ignorado.")
        return

    with state_lock:
        state[tid] = {"connected": False, "last_seen": 0, "latencia_ms": None, "tipo": "sdk_tcp"}

    logger.info(f"[SDK-TCP] A monitorizar '{nome}' em {host}:{porta}")

    while not stop_event.is_set():
        t0 = time.time()
        try:
            with socket.create_connection((host, porta), timeout=SDK_TCP_TIMEOUT):
                latencia = int((time.time() - t0) * 1000)
                with state_lock:
                    state[tid] = {"connected": True, "last_seen": time.time(), "latencia_ms": latencia, "tipo": "sdk_tcp"}
                logger.info(f"[SDK-TCP] '{nome}' {host}:{porta} → ONLINE (lat={latencia}ms)")
        except Exception:
            with state_lock:
                state[tid]["connected"] = False
            logger.debug(f"[SDK-TCP] '{nome}' {host}:{porta} → OFFLINE")

        for _ in range(intervalo):
            if stop_event.is_set(): break
            time.sleep(1)


# ──────────────────────────────────────────────────────────────
# Ciclo de Reporte → NOC Monitor
# ──────────────────────────────────────────────────────────────
def _report_once(terminais, app_id, api_key):
    """Envia um ciclo de reporte para todos os terminais dados."""
    sess = requests.Session()
    try:
        for t in terminais:
            tid  = t["id"]
            nome = t.get("nome", tid)
            with state_lock:
                estado = state.get(tid, {})
            connected   = estado.get("connected", False)
            last_seen   = estado.get("last_seen", 0)
            latencia    = estado.get("latencia_ms")
            seg_offline = int(time.time() - last_seen) if not connected and last_seen > 0 else 0
            status = "online" if connected else "offline"
            try:
                reportar_status(sess, app_id, api_key,
                                terminal_id=tid, status=status,
                                latencia_ms=latencia, segundos_sem_ping=seg_offline)
                logger.info(f"[REPORT] '{nome}' ({t.get('tipo_conexao','?')}) → {status.upper()}"
                            + (f" lat={latencia}ms" if latencia else "")
                            + (f" offline={seg_offline}s" if seg_offline else ""))
            except requests.HTTPError as e:
                code = e.response.status_code if e.response is not None else "?"
                logger.error(f"[REPORT] HTTP {code} ao reportar '{nome}'")
            except Exception as e:
                logger.error(f"[REPORT] Erro '{nome}': {e}")
    finally:
        sess.close()


def _iniciar_thread_terminal(t, stop_event, intervalo, adms_port):
    """Inicia a thread de monitorização para um terminal, se ainda não existir."""
    tid  = t["id"]
    tipo = t.get("tipo_conexao")
    with active_threads_lock:
        if tid in active_threads and active_threads[tid].is_alive():
            return  # já está a correr
        if tipo == "heartbeat":
            th = threading.Thread(target=heartbeat_listener, args=(t, stop_event),
                                  name=f"hb-{t['nome']}", daemon=True)
        elif tipo == "sdk_tcp":
            th = threading.Thread(target=sdk_tcp_poller, args=(t, stop_event, intervalo),
                                  name=f"sdk-{t['nome']}", daemon=True)
        else:
            return  # ADMS e outros não têm thread por terminal
        th.start()
        active_threads[tid] = th
        logger.info(f"[RELOAD] Nova thread iniciada para '{t['nome']}' ({tipo})")


def ciclo_reporte_com_reload(terminais_inicial, app_id, api_key, stop_event, intervalo, adms_port):
    """
    Ciclo de reporte com recarga automática de terminais a cada RELOAD_INTERVAL segundos.
    Novos terminais adicionados no painel são detectados e monitorizados sem reiniciar o serviço.
    """
    global sn_to_terminal
    terminais_geridos = list(terminais_inicial)
    ultimo_reload     = time.time()
    logger.info(f"[REPORT] Ciclo activo — intervalo={intervalo}s | auto-reload cada {RELOAD_INTERVAL}s")

    while not stop_event.is_set():
        # ── Recarga automática de terminais ─────────────────────
        if time.time() - ultimo_reload >= RELOAD_INTERVAL:
            try:
                sess = requests.Session()
                novos = listar_terminais(sess, app_id, api_key)
                sess.close()
                ids_actuais = {t["id"] for t in terminais_geridos}
                ids_novos   = {t["id"] for t in novos if t.get("tipo_conexao") in ("heartbeat","adms_push","sdk_tcp")}

                adicionados = [t for t in novos if t["id"] not in ids_actuais and t.get("tipo_conexao") in ("heartbeat","adms_push","sdk_tcp")]
                removidos   = [t for t in terminais_geridos if t["id"] not in ids_novos]

                if adicionados:
                    logger.info(f"[RELOAD] +{len(adicionados)} novo(s) terminal(is) detectado(s)")
                    for t in adicionados:
                        tipo = t.get("tipo_conexao")
                        if tipo == "adms_push":
                            sn = t.get("numero_serie","").strip()
                            if sn:
                                sn_to_terminal[sn] = t["id"]
                                logger.info(f"[RELOAD] ADMS mapeado: SN={sn} → '{t['nome']}'")
                        _iniciar_thread_terminal(t, stop_event, intervalo, adms_port)
                    terminais_geridos.extend(adicionados)

                if removidos:
                    logger.info(f"[RELOAD] -{len(removidos)} terminal(is) removido(s) do painel")
                    terminais_geridos = [t for t in terminais_geridos if t["id"] in ids_novos]

                ultimo_reload = time.time()
            except Exception as e:
                logger.warning(f"[RELOAD] Falha na recarga: {e}")

        # ── Ciclo de reporte ─────────────────────────────────────
        _report_once(terminais_geridos, app_id, api_key)

        for _ in range(intervalo):
            if stop_event.is_set(): return
            time.sleep(1)


# ──────────────────────────────────────────────────────────────
# Orquestrador Principal
# ──────────────────────────────────────────────────────────────
def run_noc_server(stop_event=None):
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

        app_id    = config["APP_ID"]
        api_key   = config["API_KEY"]
        intervalo = config.get("INTERVALO_REPORT", DEFAULT_INTERVAL)
        adms_port = config.get("ADMS_PORT", DEFAULT_ADMS_PORT)

        logger.info("=" * 65)
        logger.info("  NOC Monitor — Servidor Unificado")
        logger.info(f"  Heartbeat TCP: portas por terminal")
        logger.info(f"  ADMS/Push HTTP: porta {adms_port}")
        logger.info(f"  SDK-TCP polling: porta configurada por terminal")
        logger.info("=" * 65)

        # Obter terminais
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
            logger.warning("Nenhum terminal encontrado. Adicione terminais no painel NOC Monitor.")
            return 0

        hb_terminais   = [t for t in terminais if t.get("tipo_conexao") == "heartbeat"]
        adms_terminais = [t for t in terminais if t.get("tipo_conexao") == "adms_push"]
        sdk_terminais  = [t for t in terminais if t.get("tipo_conexao") == "sdk_tcp"]
        ws_terminais   = [t for t in terminais if t.get("tipo_conexao") == "websocket_cloud"]
        # Excluir websocket_cloud — geridos exclusivamente pelo timmy_ws_server.py
        # O ciclo de reporte só deve reportar terminais que este servidor monitoriza
        terminais_geridos = hb_terminais + adms_terminais + sdk_terminais

        logger.info(f"Terminais: {len(hb_terminais)} Heartbeat | {len(adms_terminais)} ADMS/Push | {len(sdk_terminais)} SDK-TCP | {len(ws_terminais)} WebSocket Cloud (ignorados — use timmy_ws_server.py)")

        # Construir mapa SN → terminal_id para ADMS
        global sn_to_terminal
        for t in adms_terminais:
            sn = t.get("numero_serie", "").strip()
            if sn:
                sn_to_terminal[sn] = t["id"]
                logger.info(f"  [ADMS] Mapeado: SN={sn} → '{t['nome']}'")
            else:
                logger.warning(f"  [ADMS] '{t['nome']}' sem número de série — não será monitorizado via ADMS!")

        # Iniciar threads Heartbeat TCP (1 por terminal)
        for t in hb_terminais:
            _iniciar_thread_terminal(t, stop_event, intervalo, adms_port)
            logger.info(f"  [HB-TCP] Thread iniciada para '{t['nome']}' :{t.get('porta',5005)}")

        # Iniciar servidor ADMS/Push HTTP (se houver terminais ADMS)
        if adms_terminais:
            adms_thread = threading.Thread(target=start_adms_server, args=(adms_port, stop_event),
                                           name="adms-http", daemon=True)
            adms_thread.start()

        # Iniciar threads SDK-TCP (1 por terminal)
        for t in sdk_terminais:
            _iniciar_thread_terminal(t, stop_event, intervalo, adms_port)
            logger.info(f"  [SDK-TCP] Poller iniciado para '{t['nome']}'")

        # Aviso sobre terminais WebSocket Cloud (não geridos por este servidor)
        if ws_terminais:
            logger.info(f"  [WS] {len(ws_terminais)} terminal(is) WebSocket Cloud — NÃO geridos aqui.")
            logger.info(f"  [WS] Use timmy_ws_server.py para estes terminais:")
            for t in ws_terminais:
                logger.info(f"    - '{t['nome']}' SN={t.get('numero_serie','?')}")

        if not terminais_geridos:
            logger.warning("Nenhum terminal Heartbeat/ADMS/SDK encontrado. Nada a fazer — encerrando.")
            return 0

        # Ciclo de reporte + recarga automática de terminais a quente
        ciclo_reporte_com_reload(terminais_geridos, app_id, api_key, stop_event, intervalo, adms_port)
        return 0

    except KeyboardInterrupt:
        logger.info("Interrompido pelo utilizador.")
        stop_event.set()
        return 0
    finally:
        lock.release()


def load_config():
    api_key  = os.environ.get("BASE44_API_KEY", "").strip()
    app_id   = os.environ.get("BASE44_APP_ID", "").strip()
    interval = int(os.environ.get("HB_INTERVAL", "0"))
    adms_port = int(os.environ.get("ADMS_PORT", "0"))
    if api_key and app_id and len(api_key) >= 16:
        return {"API_KEY": api_key, "APP_ID": app_id,
                "INTERVALO_REPORT": interval or DEFAULT_INTERVAL,
                "ADMS_PORT": adms_port or DEFAULT_ADMS_PORT}
    if os.path.exists(CONFIG_FILE):
        try:
            cfg = json.load(open(CONFIG_FILE, encoding="utf-8"))
            api_key  = (cfg.get("API_KEY") or "").strip()
            app_id   = (cfg.get("APP_ID")  or "").strip()
            if api_key and app_id and len(api_key) >= 16:
                return {
                    "API_KEY": api_key, "APP_ID": app_id,
                    "INTERVALO_REPORT": cfg.get("INTERVALO_REPORT", DEFAULT_INTERVAL),
                    "ADMS_PORT": cfg.get("ADMS_PORT", DEFAULT_ADMS_PORT),
                }
            logger.error("config.json inválido: API_KEY ou APP_ID ausentes.")
        except Exception as e:
            logger.error(f"Falha ao ler config.json: {e}")
    return None


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="NOC Monitor — Servidor Unificado")
    parser.add_argument("--interval", type=int, default=0)
    parser.add_argument("--adms-port", type=int, default=0)
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()

    setup_logging(logging.DEBUG if args.debug else logging.INFO)

    if args.interval:   os.environ["HB_INTERVAL"] = str(args.interval)
    if args.adms_port:  os.environ["ADMS_PORT"]   = str(args.adms_port)

    sys.exit(run_noc_server())
`;

const SECTIONS = [
  { key: 'heartbeat', label: 'Heartbeat TCP', color: 'violet', badge: 'TCP', desc: 'Terminal conecta TCP → online/offline por timeout. Cada terminal usa uma porta diferente.' },
  { key: 'adms',      label: 'ADMS / Push',   color: 'blue',   badge: 'HTTP', desc: 'ZKTeco ADMS, Anviz CrossChex — terminal faz HTTP POST. Servidor fica em http://127.0.0.1:8080.' },
  { key: 'sdk',       label: 'SDK-TCP',        color: 'emerald', badge: 'TCP', desc: 'Polling activo na porta ZKTeco SDK (4370). Terminal precisa de ter IP acessível.' },
];

export default function NocServerCode() {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(NOC_SERVER_CODE);
    setCopied(true);
    toast.success('Código copiado!');
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownload = () => {
    const blob = new Blob([NOC_SERVER_CODE], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'noc_server.py';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('noc_server.py descarregado!');
  };

  return (
    <div className="space-y-4">
      {/* Modos suportados */}
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
        <p className="text-slate-500 font-sans font-semibold mb-2 text-xs">📄 C:\ProgramData\NOCMonitor\config.json</p>
        <p className="text-slate-700">{`{`}</p>
        <p className="text-slate-700 pl-4">{`"API_KEY": "a_sua_api_key_pessoal",`}</p>
        <p className="text-slate-700 pl-4">{`"APP_ID":  "697aa46c9998c30665e2e19a",`}</p>
        <p className="text-slate-700 pl-4">{`"INTERVALO_REPORT": 30,`}</p>
        <p className="text-slate-700 pl-4 font-semibold text-blue-700">{`"ADMS_PORT": 8080`}</p>
        <p className="text-slate-700">{`}`}</p>
      </div>

      {/* Firewall */}
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
        <p className="font-semibold">🔥 Portas a abrir no Firewall do Windows Server (127.0.0.1)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-1">
          <p>• <strong>8080 TCP</strong> — Servidor ADMS/Push (ZKTeco, Anviz)</p>
          <p>• <strong>5005–5xxx TCP</strong> — Portas Heartbeat (uma por terminal)</p>
          <p>• <strong>4370 TCP</strong> — SDK-TCP ZKTeco (saída para terminais)</p>
        </div>
        <p className="mt-1 text-amber-700">Configure em: <em>Windows Defender Firewall → Regras de Entrada → Nova Regra → Porta TCP</em></p>
      </div>

      {/* Config ADMS no terminal ZKTeco */}
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 space-y-1">
        <p className="font-semibold">📱 Configuração ADMS no terminal ZKTeco</p>
        <p>Menu Principal → Comm → Cloud Server Settings (ou ADMS):</p>
        <div className="font-mono bg-blue-100 px-2 py-1.5 rounded mt-1 space-y-0.5">
          <p>Server Address: <strong>127.0.0.1</strong></p>
          <p>Server Port: <strong>8080</strong></p>
          <p>HTTPS: <strong>Desativado</strong></p>
          <p>Device Push: <strong>Ativado</strong></p>
        </div>
        <p className="mt-1 text-blue-600">⚠️ O número de série (SN) do terminal <strong>deve ser registado</strong> no painel NOC Monitor ao criar o terminal.</p>
      </div>

      {/* Passos instalação */}
      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 space-y-1">
        <p className="font-semibold">⚡ Instalação no Windows Server</p>
        <p>1. Python 3.9+ → <code className="bg-emerald-100 px-1 rounded">pip install requests</code></p>
        <p>2. Copiar <code className="bg-emerald-100 px-1 rounded">noc_server.py</code> para <code className="bg-emerald-100 px-1 rounded">C:\Program Files\NOCMonitor\</code></p>
        <p>3. Criar <code className="bg-emerald-100 px-1 rounded">C:\ProgramData\NOCMonitor\config.json</code></p>
        <p>4. Instalar como serviço:</p>
        <code className="bg-emerald-100 px-2 py-1 rounded block">
          nssm install NOCMonitor "C:\Python311\python.exe" "C:\Program Files\NOCMonitor\noc_server.py"
        </code>
        <code className="bg-emerald-100 px-2 py-1 rounded block mt-1">
          nssm start NOCMonitor
        </code>
      </div>

      {/* Botões download */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Server className="h-4 w-4 text-slate-500" />
          noc_server.py — Servidor Unificado
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
          {NOC_SERVER_CODE}
        </pre>
      )}
    </div>
  );
}