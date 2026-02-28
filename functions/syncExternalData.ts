import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        // Apenas admin pode executar sincronização
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Buscar configurações ativas
        const configs = await base44.asServiceRole.entities.MonitorConfig.filter({ ativo: true });

        if (configs.length === 0) {
            return Response.json({ 
                success: true, 
                message: 'Nenhuma configuração ativa encontrada' 
            });
        }

        const results = [];

        for (const config of configs) {
            try {
                let terminalsData = [];

                if (config.tipo === 'api_externa') {
                    // Buscar dados da API externa
                    const headers = {};
                    
                    if (config.api_auth_type === 'bearer') {
                        headers['Authorization'] = `Bearer ${config.api_auth_token}`;
                    } else if (config.api_auth_type === 'api_key') {
                        headers['X-API-Key'] = config.api_auth_token;
                    }

                    const response = await fetch(config.api_url, { headers });
                    
                    if (!response.ok) {
                        throw new Error(`API retornou status ${response.status}`);
                    }

                    terminalsData = await response.json();

                } else if (config.tipo === 'sql_server') {
                    // Para SQL Server, seria necessário usar uma biblioteca específica
                    // ou fazer via API intermediária
                    // Por enquanto, retornar erro explicativo
                    throw new Error('Conexão direta SQL Server requer configuração adicional. Use API intermediária.');
                }

                // Processar dados recebidos
                let synced = 0;
                
                for (const data of terminalsData) {
                    // Procurar terminal existente por nome ou criar novo
                    const existing = await base44.asServiceRole.entities.Terminal.filter({ 
                        nome: data.nome 
                    });

                    if (existing.length > 0) {
                        // Atualizar terminal existente
                        await base44.asServiceRole.entities.Terminal.update(existing[0].id, {
                            ultimo_ping: data.ultimo_ping || new Date().toISOString(),
                            status: data.status || 'offline',
                            ip_local: data.ip_local,
                            ip_publico: data.ip_publico,
                            porta: data.porta,
                            local: data.local,
                            cliente_nome: data.cliente
                        });
                    } else {
                        // Criar novo terminal
                        await base44.asServiceRole.entities.Terminal.create({
                            nome: data.nome,
                            local: data.local || 'Não especificado',
                            cliente_nome: data.cliente || 'Não especificado',
                            tipo_conexao: data.tipo_conexao || 'ip_local',
                            ip_local: data.ip_local,
                            ip_publico: data.ip_publico,
                            porta: data.porta || 5005,
                            status: data.status || 'offline',
                            ultimo_ping: data.ultimo_ping || new Date().toISOString(),
                            ativo: true
                        });
                    }
                    
                    synced++;
                }

                // Atualizar status da configuração
                await base44.asServiceRole.entities.MonitorConfig.update(config.id, {
                    ultima_sync: new Date().toISOString(),
                    ultima_sync_status: 'success'
                });

                results.push({
                    config_id: config.id,
                    tipo: config.tipo,
                    success: true,
                    synced
                });

            } catch (error) {
                // Atualizar status da configuração com erro
                await base44.asServiceRole.entities.MonitorConfig.update(config.id, {
                    ultima_sync: new Date().toISOString(),
                    ultima_sync_status: `error: ${error.message}`
                });

                results.push({
                    config_id: config.id,
                    tipo: config.tipo,
                    success: false,
                    error: error.message
                });
            }
        }

        return Response.json({
            success: true,
            configs_processadas: configs.length,
            results
        });

    } catch (error) {
        console.error('Erro ao sincronizar dados externos:', error);
        return Response.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
});