import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    const { from_email, from_name, from_phone, message, tipo } = payload;

    if (!from_email || !message) {
      return Response.json({ error: 'Dados incompletos' }, { status: 400 });
    }

    // Get admin email(s)
    const adminUsers = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
    const adminEmails = adminUsers.map(u => u.email).join(', ');

    if (!adminEmails) {
      console.error('Nenhum admin encontrado para contato');
      return Response.json({ error: 'Nenhum administrador disponível' }, { status: 500 });
    }

    // Create contact message in database (optional: for audit trail)
    try {
      await base44.asServiceRole.entities.ContactMessage.create({
        from_email,
        from_name,
        from_phone,
        message,
        tipo,
        data_envio: new Date().toISOString(),
        lido: false,
      });
    } catch (e) {
      // ContactMessage entity might not exist, skip
      console.log('ContactMessage entity não existe ou erro ao salvar');
    }

    // Send email to admin(s)
    const emailBody = `
MENSAGEM DE CONTATO DO USUÁRIO

De: ${from_name || 'N/A'} <${from_email}>
Telefone: ${from_phone || 'N/A'}
Tipo: ${tipo === 'new_user_inquiry' ? 'Solicitação de Acesso em Análise' : 'Contato Geral'}

MENSAGEM:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${message}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Responda diretamente para o email do usuário.
    `.trim();

    await base44.integrations.Core.SendEmail({
      to: adminEmails,
      subject: `[NOC Monitor] Nova Mensagem: ${from_name || from_email}`,
      body: emailBody,
      from_name: 'NOC Monitor - Contatos',
    });

    // Send confirmation email to user
    const confirmationEmail = `
Olá ${from_name},

Recebemos sua mensagem com sucesso! Um administrador analisará sua solicitação em breve.

Dados registados:
Email: ${from_email}
Telefone: ${from_phone || 'N/A'}

Você será contatado em breve.

Atenciosamente,
Equipe NOC Monitor
    `.trim();

    await base44.integrations.Core.SendEmail({
      to: from_email,
      subject: '[NOC Monitor] Mensagem Recebida - Aguarde Contato',
      body: confirmationEmail,
      from_name: 'NOC Monitor - Suporte',
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});