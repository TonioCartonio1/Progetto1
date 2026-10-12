import { ROLE_LABEL } from '../lib/roles'
import { Avatar, Icon } from './ui'

const ORDER = ['admin', 'moderator', 'member']
const GROUP_LABEL = { admin: 'Admin', moderator: 'Moderatori', member: 'Membri' }

export default function MembersPanel({ members, online, onClose }) {
  return (
    <aside className="members">
      <header className="members-head">
        <span>{members.length} {members.length === 1 ? 'membro' : 'membri'}, {members.filter((m) => online.has(m.user_id)).length} online</span>
        <button className="icon-btn small" onClick={onClose} aria-label="Chiudi"><Icon name="x" size={15} /></button>
      </header>
      {ORDER.map((role) => {
        const list = members
          .filter((m) => m.role === role)
          .sort((a, b) => Number(online.has(b.user_id)) - Number(online.has(a.user_id)))
        if (!list.length) return null
        return (
          <section key={role}>
            <h3 className="members-group">{GROUP_LABEL[role]} <span>{list.length}</span></h3>
            <ul>
              {list.map((m) => {
                const on = online.has(m.user_id)
                return (
                  <li key={m.user_id} className={`member ${on ? '' : 'offline'}`} title={`${m.profiles?.display_name} · ${ROLE_LABEL[m.role]}`}>
                    <Avatar id={m.user_id} name={m.profiles?.display_name} url={m.profiles?.avatar_url} size={32} online={on} />
                    <span className="member-name">{m.profiles?.display_name || 'Utente'}</span>
                    {role !== 'member' && <span className={`role-pill ${role}`}>{role === 'admin' ? 'A' : 'M'}</span>}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </aside>
  )
}
