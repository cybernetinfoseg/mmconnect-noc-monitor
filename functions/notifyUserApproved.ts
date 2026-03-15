import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { email, nome, role } = await req.json();

    // Valida se email foi fornecido
    if (!email) {
      return Response.json({ error: 'Email é obrigatório' }, { status: 400 });
    }

    // Envia email de aprovação
    await base44.integrations.Core.SendEmail({
      to: email,
      subject: 'Sua conta no NOC Monitor foi aprovada! ✅',
      body: `
Olá ${nome || 'usuário'},

Sua solicitação de acesso ao NOC Monitor foi **APROVADA**! 🎉

**Informações da sua conta:**
- Email: ${email}
- Papel: ${getRoleLabel(role)}
- Status: ✅ Ativo

Você agora tem acesso total ao sistema. Pode fazer login no NOC Monitor usando suas credenciais.

Se tiver qualquer dúvida, entre em contato com o administrador do sistema.

---
NOC Monitor - Monitoramento de Terminais Biométricos
      `
    });

    return Response.json({ success: true, message: 'Email de aprovação enviado' });
  } catch (error) {
    console.error('Erro ao enviar email:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function getRoleLabel(role) {
  const labels = {
    admin: 'Administrador',
    editor: 'Editor',
    viewer: 'Visualizador'
  };
  return labels[role] || role;
}