#!/usr/bin/env python3
"""
Script de Monitoramento Local de Terminais
Roda na rede local e atualiza status no Base44

INSTALAÇÃO:
    pip install requests

USO:
    1. Configure MONITOR_API_KEY abaixo (mesmo valor do secret no Base44)
    2. Execute: python monitor_local.py
"""

import socket
import time
import requests
from datetime import datetime
from typing import Dict, List, Optional

# ==================== CONFIGURAÇÃO ====================
APP_ID = "697aa46c9998c30665e2e19a"
MONITOR_API_KEY = "!Uolcor20"  # Valor do secret API_KEY no Base44

# URLs das funções backend
BASE_URL = f"https://app.base44.com/api/apps/{APP_ID}/functions"
GET_TERMINALS_URL = f"{BASE_URL}/getLocalTerminals/invoke"
UPDATE_STATUS_URL = f"{BASE_URL}/updateTerminalStatus/invoke"

# Intervalo de verificação (segundos)
CHECK_INTERVAL = 30

# Timeout para teste TCP (segundos)
SOCKET_TIMEOUT = 5
# ======================================================


def test_tcp_connection(host: str, port: int) -> tuple:
    """Testa conexão TCP. Retorna (sucesso, latencia_ms, erro)"""
    start = time.time()
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(SOCKET_TIMEOUT)
        result = sock.connect_ex((host, int(port)))
        sock.close()
        latencia = int((time.time() - start) * 1000)
        if result == 0:
            return True, latencia, None
        return False, None, f"Porta {port} fechada ou inacessível"
    except socket.timeout:
        return False, None, f"Timeout após {SOCKET_TIMEOUT}s"
    except socket.gaierror:
        return False, None, "Erro DNS - host não encontrado"
    except Exception as e:
        return False, None, str(e)


def get_local_terminals() -> List[Dict]:
    """Busca terminais ip_local via função backend Base44"""
    try:
        headers = {
            "Content-Type": "application/json",
            "X-Monitor-API-Key": MONITOR_API_KEY
        }
        response = requests.post(GET_TERMINALS_URL, headers=headers, json={}, timeout=15)
        if response.status_code == 200:
            data = response.json()
            return data.get("terminals", [])
        print(f"❌ Erro ao buscar terminais: {response.status_code} - {response.text}")
        return []
    except Exception as e:
        print(f"❌ Erro ao buscar terminais: {e}")
        return []


def update_terminal_status(terminal_id: str, status: str, latencia: Optional[int], error_msg: Optional[str]) -> bool:
    """Envia atualização de status para Base44"""
    try:
        headers = {
            "Content-Type": "application/json",
            "X-Monitor-API-Key": MONITOR_API_KEY
        }
        payload = {
            "terminalId": terminal_id,
            "status": status,
            "latencia": latencia,
            "errorMsg": error_msg
        }
        response = requests.post(UPDATE_STATUS_URL, headers=headers, json=payload, timeout=15)
        return response.status_code == 200
    except Exception as e:
        print(f"❌ Erro ao enviar status: {e}")
        return False


def monitor_terminal(terminal: Dict):
    """Monitora um terminal específico"""
    terminal_id = terminal.get("id")
    nome = terminal.get("nome", "Desconhecido")
    ip = terminal.get("ip_local")
    porta = terminal.get("porta", 5005)

    if not ip:
        print(f"⚠️  {nome}: IP local não configurado")
        return

    sucesso, latencia, erro = test_tcp_connection(ip, porta)
    status = "online" if sucesso else "offline"

    if update_terminal_status(terminal_id, status, latencia, erro):
        if sucesso:
            print(f"✅ {nome} ({ip}:{porta}): ONLINE - {latencia}ms")
        else:
            print(f"❌ {nome} ({ip}:{porta}): OFFLINE - {erro}")
    else:
        print(f"⚠️  {nome}: falha ao enviar status para Base44")


def main():
    print("=" * 60)
    print("🚀 Monitor Local de Terminais - Base44")
    print("=" * 60)
    print(f"App ID:        {APP_ID}")
    print(f"Intervalo:     {CHECK_INTERVAL}s")
    print(f"Timeout TCP:   {SOCKET_TIMEOUT}s")
    print(f"Endpoint:      {GET_TERMINALS_URL}")
    print("=" * 60)

    if MONITOR_API_KEY == "SUA_CHAVE_AQUI":
        print("\n❌ ERRO: Configure a MONITOR_API_KEY no início do script!")
        print("   O valor está em: Dashboard Base44 → Settings → Secrets → MONITOR_API_KEY")
        return

    ciclo = 0
    while True:
        ciclo += 1
        print(f"\n📡 Ciclo #{ciclo} - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("-" * 60)

        terminals = get_local_terminals()

        if not terminals:
            print("⚠️  Nenhum terminal IP local encontrado")
        else:
            print(f"📋 {len(terminals)} terminal(is) encontrado(s)\n")
            for terminal in terminals:
                monitor_terminal(terminal)

        print(f"\n⏳ Aguardando {CHECK_INTERVAL}s para próximo ciclo...")
        time.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n👋 Monitor encerrado pelo usuário")
    except Exception as e:
        print(f"\n\n❌ Erro fatal: {e}")