export const ROLE_RANK = { admin: 3, moderator: 2, member: 1 }
export const ROLE_LABEL = { admin: 'Admin', moderator: 'Moderatore', member: 'Membro' }
export const rank = (r) => ROLE_RANK[r] || 0
export const canManageChannels = (role) => rank(role) >= 2
export const canModerate = (role) => rank(role) >= 2

export const PRIVACY_OPTIONS = [
  { value: '', label: 'Tutti i membri' },
  { value: 'moderator', label: 'Solo moderatori e admin' },
  { value: 'admin', label: 'Solo admin' },
]
