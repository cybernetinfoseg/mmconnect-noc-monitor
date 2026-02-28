import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { baseIp, startHost, endHost, port, timeout } = await req.json();
        
        if (!baseIp || !startHost || !endHost || !port) {
            return Response.json({ 
                error: 'baseIp, startHost, endHost e port são obrigatórios' 
            }, { status: 400 });
        }

        const results = [];
        const timeoutMs = timeout || 3000;

        // Extrair base do IP (ex: "192.168.1" de "192.168.1.x")
        const ipBase = baseIp.substring(0, baseIp.lastIndexOf('.'));

        for (let i = startHost; i <= endHost; i++) {
            const host = `${ipBase}.${i}`;
            let status = 'offline';
            let latencia = null;

            try {
                const startTime = Date.now();
                
                // Tentar HTTP primeiro
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
                    
                    const response = await fetch(`http://${host}:${port}`, {
                        method: 'GET',
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    status = 'online';
                    latencia = Date.now() - startTime;
                    
                } catch (httpError) {
                    // Tentar TCP
                    try {
                        const conn = await Promise.race([
                            Deno.connect({ hostname: host, port: port }),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('timeout')), timeoutMs)
                            )
                        ]);
                        
                        conn.close();
                        status = 'online';
                        latencia = Date.now() - startTime;
                    } catch (tcpError) {
                        // Offline
                    }
                }
            } catch (error) {
                // Offline
            }

            if (status === 'online') {
                results.push({
                    host,
                    port,
                    status,
                    latencia
                });
            }
        }

        return Response.json({
            success: true,
            scanned: endHost - startHost + 1,
            found: results.length,
            results
        });

    } catch (error) {
        console.error('Erro ao escanear rede:', error);
        return Response.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
});