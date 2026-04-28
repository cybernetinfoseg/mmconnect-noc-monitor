// Permission resolution helper

export const ROLE_LABELS = {
  admin: 'Administrador',
  user: 'Utilizador',
};

export const ROLE_COLORS = {
  admin: 'bg-purple-100 text-purple-800 border-purple-200',
  user: 'bg-slate-100 text-slate-700 border-slate-200',
};

const ALL_PAGES = [
  'Dashboard', 'TVMode', 'Terminais', 'Mapa', 'History',
  'Incidents', 'Alertas', 'Manutencao', 'Agendamentos', 'Relatorios',
  'Auditoria', 'Configuracoes', 'Administracao',
  'Utilizadores', 'Marcacoes', 'ExportacaoMarcacoes',
];

const ADMIN_ONLY_PAGES = ['Administracao', 'Configuracoes'];

export function resolvePermissions(user) {
  const isAdmin = user?.role === 'admin';

  const paginas_permitidas = isAdmin
    ? ALL_PAGES
    : ALL_PAGES.filter(p => !ADMIN_ONLY_PAGES.includes(p));

  return {
    isAdmin,
    paginas_permitidas,
    pode_editar_terminais: true,
    pode_configurar_alertas: isAdmin,
    pode_filtrar_por_utilizador: isAdmin,
    limite_terminais: user?.limite_terminais ?? 0,
  };
}