import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    const { email, nome, sobrenome, telefone, motivo_acesso, data_inscricao } = payload;

    if (!email || !nome || !sobrenome || !telefone) {
      return Response.json({ error: 'Dados incompletos' }, { status: 400 });
    }

    // Get admin email (or list of admins)
    const adminUsers = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
    const adminEmails = adminUsers.map(u => u.email).join(', ');

    if (!adminEmails) {
      console.error('Nenhum admin encontrado para notificação');
      return Response.json({ success: true }); // Don't fail if no admin
    }

    // Send email notification to admin(s)
    const emailBody = `
NOVO USUÁRIO REGISTRADO NO SISTEMA

Data de Inscrição: ${data_inscricao}

DADOS PESSOAIS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Nome: ${nome} ${sobrenome}
Email: ${email}
Telefone: ${telefone}

MOTIVO DO ACESSO:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${motivo_acesso || '(Não informado)'}

PRÓXIMAS AÇÕES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Acesse a página de Administração
2. Revise os dados na seção de "Aprovações Pendentes"
3. Configure as permissões apropriadas
4. Aprove ou rejeite o acesso do usuário

O usuário pode entrar em contato através do formulário de contato disponível na página de pendência.
    `.trim();

    await base44.integrations.Core.SendEmail({
      to: adminEmails,
      subject: `[NOC Monitor] Novo Usuário para Aprovação: ${nome} ${sobrenome}`,
      body: emailBody,
      from_name: 'NOC Monitor - Sistema',
    });

    // Log audit via service role (sem utilizador autenticado neste contexto)
    await base44.asServiceRole.entities.AuditLog.create({
      usuario_email: email,
      acao: 'usuario_convidado',
      entidade: 'User',
      entidade_id: email,
      descricao: `Novo usuário registrado: ${nome} ${sobrenome} (${email}). Admin notificado.`,
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    return Response.json({ success: true });
  } catch (error) {
    console.error('Erro ao notificar admin:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});