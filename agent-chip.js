// "My profile" in the top bar: a signed-in agent's profile photo, linking straight to their public profile.
// Shown only while an agent is signed in on this device; nothing private is shown (the photo is already public).
import { loadAgentSession } from './agent-portal.js?v=20261126-mp1';
import { loadAgent, initials } from './agent-profiles.js?v=20261126-fp1';

const safePhoto = url => typeof url === 'string' && /^https:\/\/res\.cloudinary\.com\//.test(url) ? url : '';

/** React component. `react` is passed in so both the homepage and the compiled app header can use it. */
export function AgentChip({ react: React }) {
  const h = React.createElement;
  const [session, setSession] = React.useState(() => loadAgentSession());
  const [photo, setPhoto] = React.useState('');
  React.useEffect(() => {
    // Sign-in and sign-out on this page send "dh-agent-session"; other tabs change storage.
    const sync = () => setSession(loadAgentSession());
    window.addEventListener('dh-agent-session', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('dh-agent-session', sync); window.removeEventListener('storage', sync); };
  }, []);
  const id = session && session.agent && session.agent.id;
  React.useEffect(() => {
    if (!id) { setPhoto(''); return; }
    let live = true;
    loadAgent(id).then(a => { if (live) setPhoto(a ? safePhoto(a.logo) : ''); });
    return () => { live = false; };
  }, [id]);
  if (!id) return null;
  const name = session.agent.name || session.agent.agency || 'My profile';
  const open = event => {
    // On the homepage the profile opens over the page; elsewhere the homepage loads with the profile open.
    if (document.querySelector('.dh-home-header')) return;
    event.preventDefault();
    location.assign(location.pathname + '?me=' + Date.now().toString(36) + '#agent=' + id);
  };
  return h('a', { href: '#agent=' + id, onClick: open, className: 'dh-my-profile', title: `My profile · ${name}`, 'aria-label': 'My profile' },
    h('span', { className: 'dh-my-profile-photo', 'aria-hidden': 'true' }, photo ? h('img', { src: photo, alt: '' }) : initials(name)),
    h('span', { className: 'dh-my-profile-label' }, 'My profile'));
}
