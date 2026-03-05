/**
 * Role-based permission system
 *
 * Roles:
 *  admin  - full access to everything
 *  editor - can view and edit terminals/clients, configure alerts; cannot manage users or access admin/audit
 *  viewer - read-only access to dashboard, terminals, incidents, history
 */

export const ROLE_DEFAULTS = {
  admin: {
    paginas_permitidas: ['Dashboard', 'Terminais', 'Clientes', 'History', 'Incidents', 'Alertas', 'Configuracoes', 'Administracao', 'Auditoria'],
    pode_configurar_alertas: true,
    pode_gerenciar_usuarios: true,
    pode_editar_terminais: true,
    pode_editar_clientes: true,
    limite_terminais: 9999,
  },
  editor: {
    paginas_permitidas: ['Dashboard', 'Terminais', 'Clientes', 'History', 'Incidents', 'Alertas', 'Configuracoes'],
    pode_configurar_alertas: true,
    pode_gerenciar_usuarios: false,
    pode_editar_terminais: true,
    pode_editar_clientes: true,
    limite_terminais: 50,
  },
  viewer: {
    paginas_permitidas: ['Dashboard', 'Terminais', 'History', 'Incidents'],
    pode_configurar_alertas: false,
    pode_gerenciar_usuarios: false,
    pode_editar_terminais: false,
    pode_editar_clientes: false,
    limite_terminais: 0,
  },
};

export const ROLE_LABELS = {
  admin: 'Administrador',
  editor: 'Editor',
  viewer: 'Visualizador',
};

export const ROLE_COLORS = {
  admin: 'bg-purple-100 text-purple-700 border-purple-200',
  editor: 'bg-blue-100 text-blue-700 border-blue-200',
  viewer: 'bg-slate-100 text-slate-600 border-slate-200',
};

// Permissions for a brand-new user who hasn't been configured by admin yet
const NEW_USER_DEFAULTS = {
  paginas_permitidas: [],
  pode_configurar_alertas: false,
  pode_gerenciar_usuarios: false,
  pode_editar_terminais: false,
  pode_editar_clientes: false,
  limite_terminais: 0,
};

/**
 * Returns resolved permissions for a user.
 * - Admin users always get full access regardless of stored fields.
 * - Non-admin users with no paginas_permitidas set start fully locked (new user default).
 * - Individual fields stored on the user record override role defaults.
 */
export function resolvePermissions(user) {
  if (!user) return { ...NEW_USER_DEFAULTS, role: 'viewer', isAdmin: false, isEditor: false, isViewer: true, canEdit: false };

  const role = user.role || 'user';

  // Admins always have full access
  if (role === 'admin') {
    return {
      role: 'admin',
      isAdmin: true,
      isEditor: false,
      isViewer: false,
      canEdit: true,
      ...ROLE_DEFAULTS.admin,
    };
  }

  const isEditor = role === 'editor';

  // New users (no paginas_permitidas set, non-admin) start fully locked
  // Only apply role defaults if the admin has explicitly set paginas_permitidas
  const hasBeenConfigured = Array.isArray(user.paginas_permitidas) && user.paginas_permitidas.length > 0;

  return {
    role,
    isAdmin: false,
    isEditor,
    isViewer: !isEditor,
    canEdit: isEditor,
    paginas_permitidas: hasBeenConfigured
      ? user.paginas_permitidas
      : NEW_USER_DEFAULTS.paginas_permitidas,
    pode_configurar_alertas:
      user.pode_configurar_alertas != null ? user.pode_configurar_alertas : false,
    pode_gerenciar_usuarios:
      user.pode_gerenciar_usuarios != null ? user.pode_gerenciar_usuarios : false,
    pode_editar_terminais:
      user.pode_editar_terminais != null ? user.pode_editar_terminais : false,
    pode_editar_clientes:
      user.pode_editar_clientes != null ? user.pode_editar_clientes : false,
    limite_terminais:
      user.limite_terminais != null ? user.limite_terminais : 0,
  };
}