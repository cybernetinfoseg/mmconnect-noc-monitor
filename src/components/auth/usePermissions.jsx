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
  'Dashboard', 'TVMode', 'Terminais', 'Clientes', 'History',
  'Incidents', 'Alertas', 'Mensagens', 'Manutencao', 'Relatorios',
  'Auditoria', 'Configuracoes', 'Administracao',
];

const ADMIN_ONLY_PAGES = ['Mensagens', 'Administracao'];

export function resolvePermissions(user) {
  const isAdmin = user?.role === 'admin';
  const isEditor = false; // reserved for future roles

  const paginas_permitidas = isAdmin
    ? ALL_PAGES
    : ALL_PAGES.filter(p => !ADMIN_ONLY_PAGES.includes(p));

  return {
    isAdmin,
    isEditor,
    paginas_permitidas,
  };
}