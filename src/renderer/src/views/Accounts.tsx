import { motion } from 'motion/react'
import { Check, Ellipsis, KeyRound, LogIn, RefreshCw, ShieldCheck, Trash2, UserPlus, UserRound } from 'lucide-react'
import { Empty, SkinHead, softSpring, useMenu } from '../components/ui'
import { api } from '../lib/api'
import { cx } from '../lib/format'
import { confirm, guard, openSheet, toast, useStore } from '../lib/store'

export function Accounts(): React.JSX.Element {
  const accounts = useStore((s) => s.accounts)
  const menu = useMenu()

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="large-title">Contas</h1>
        <div className="spacer" />
        <div className="toolbar">
          <button className="btn" onClick={() => openSheet({ type: 'offline' })}>
            <UserPlus /> Perfil offline
          </button>
          <button className="btn accent" onClick={() => openSheet({ type: 'login' })}>
            <LogIn /> Adicionar conta Microsoft
          </button>
        </div>
      </div>
      <div className="page-scroll">
        <div className="settings-wrap">
          {!accounts.length && (
            <Empty
              icon={UserRound}
              title="Nenhuma conta"
              body="Entre com a conta Microsoft que possui o Minecraft: Java Edition para jogar."
              action={
                <button className="btn accent" style={{ marginTop: 8 }} onClick={() => openSheet({ type: 'login' })}>
                  <LogIn /> Entrar com a Microsoft
                </button>
              }
            />
          )}

          {accounts.map((a) => (
            <motion.div key={a.id} layout className={cx('account-card glass thin')} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}>
              <SkinHead url={a.skinUrl} name={a.name} size={56} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="title-3">{a.name}</span>
                  <span className={cx('badge', a.type === 'msa' ? 'accent' : '')}>{a.type === 'msa' ? 'Microsoft' : 'Offline'}</span>
                  {a.status === 'expired' && <span className="badge orange">Sessão expirada</span>}
                </div>
                <div className="caption mono truncate" style={{ marginTop: 3 }}>{a.uuid}</div>
              </div>
              {a.active ? (
                <span className="badge green" style={{ height: 26, padding: '0 12px' }}>
                  <Check /> Ativa
                </span>
              ) : (
                <button className="btn sm tinted" onClick={() => void guard(() => api.accounts.setActive(a.id))}>
                  Usar esta
                </button>
              )}
              <button
                className="btn icon sm ghost"
                onClick={(e) =>
                  menu.open(
                    e,
                    [
                      ...(a.type === 'msa'
                        ? [
                            {
                              label: a.status === 'expired' ? 'Entrar novamente' : 'Atualizar sessão',
                              icon: RefreshCw,
                              onClick: () =>
                                a.status === 'expired'
                                  ? openSheet({ type: 'login' })
                                  : void guard(() => api.accounts.refresh(a.id), 'Falha ao atualizar').then((r) => r && toast('success', 'Sessão atualizada', r.name))
                            },
                            'sep' as const
                          ]
                        : []),
                      {
                        label: 'Remover…',
                        icon: Trash2,
                        danger: true,
                        onClick: () => confirm(`Remover ${a.name}?`, 'A conta será desconectada deste launcher.', 'Remover', () => void guard(() => api.accounts.remove(a.id)))
                      }
                    ],
                    'right'
                  )
                }
              >
                <Ellipsis />
              </button>
            </motion.div>
          ))}

          <div className="group glass thin">
            <div className="group-row">
              <div className="row-icon" style={{ background: 'linear-gradient(150deg,#5ee27f,#1fa84a)' }}>
                <ShieldCheck />
              </div>
              <div className="label">
                <div>Login oficial da Microsoft</div>
                <div className="caption">Você digita a senha apenas no site da Microsoft — o Lumen nunca a vê.</div>
              </div>
            </div>
            <div className="group-row">
              <div className="row-icon" style={{ background: 'linear-gradient(150deg,#8fb8ff,#3a5fd6)' }}>
                <KeyRound />
              </div>
              <div className="label">
                <div>Tokens criptografados</div>
                <div className="caption">As sessões ficam salvas com a proteção de dados do Windows (DPAPI).</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {menu.element}
    </div>
  )
}
