import { listingService } from './listing-service.js';

export function createListingSubmission(React, service = listingService) {
  const h = React.createElement;
  const primary = 'px-6 py-3 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold text-xs disabled:opacity-40';
  const secondary = 'px-5 py-2.5 rounded-xl border border-stone-200 text-xs font-bold text-stone-700 hover:bg-stone-50 disabled:opacity-40';
  const control = 'w-full px-4 py-3 rounded-xl bg-stone-50 border border-stone-200 text-xs sm:text-sm text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-700';
    const messages = { SIGN_IN_REQUIRED: 'Sign in again to continue. Your draft is retained.', SIGN_IN_LINK_FAILED: 'That sign-in link is invalid or expired. Request a new email and try again.', CONNECTION_FAILED: 'Connection interrupted. Check submission status before retrying; your draft is retained.', VALIDATION_REQUIRED: 'Check the required listing fields. Your draft is retained.', VERSION_CONFLICT: 'This listing changed. Refresh its status before continuing.', DELIVERY_IN_PROGRESS: 'A renewal notification is being resolved. Refresh status before trying again.' };
  return function ListingSubmission({ draft, onDraftChange, valid = false, management = false, onErrors, authenticationOnly = false, onAuthenticated, initialRecord = null }) {
    const [email, setEmail] = React.useState(draft.email || ''), [code, setCode] = React.useState('');
    const [sent, setSent] = React.useState(false), [signedIn, setSignedIn] = React.useState(service.signedIn());
    const [record, setRecord] = React.useState(initialRecord), [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState('');
    const [renewal, setRenewal] = React.useState(false), [reason, setReason] = React.useState('');
    const [assignedAgentId, setAssignedAgentId] = React.useState('');
    const [lookupId, setLookupId] = React.useState(draft.submissionListingId || '');
    const attempts = React.useRef(new Map());
    React.useEffect?.(() => {
      let active = true;
      if (service.ready && !service.signedIn() && typeof service.restoreRedirectSession === 'function') service.restoreRedirectSession().then(restored => {
        if (active && restored) { setSignedIn(true); setMessage('Signed in. Refresh status to check earlier submissions.'); }
      }).catch(error => {
        if (active) setMessage(messages[error.code] || 'The sign-in link could not be verified. Request a new email and try again.');
      });
      return () => { active = false; };
    }, []);
    React.useEffect?.(() => {
      if (signedIn && authenticationOnly) onAuthenticated?.();
    }, [signedIn]);
    React.useEffect?.(() => {
      if (!signedIn || authenticationOnly || !draft.submissionListingId || record) return;
      let active = true;
      service.get(draft.submissionListingId).then(result => { if(active) setRecord(result.listing); }).catch(() => { if(active) setMessage('Refresh status to load this submitted listing.'); });
      return () => { active = false; };
    }, [signedIn, draft.submissionListingId]);
    const operate = async action => {
      if (busy) return; setBusy(true); setMessage('');
      try { await action(); } catch (error) { onErrors?.(error.fields || {}); setMessage(messages[error.code] || 'The request could not be confirmed. Your draft is retained. Refresh status or retry.'); }
      finally { setBusy(false); setSignedIn(service.signedIn()); }
    };
    const accept = result => { setRecord(result.listing); onDraftChange(old => ({ ...old, submissionListingId: result.listing.listingId })); };
    const refresh = () => operate(async () => { accept(await service.findDraft(draft.id)); setMessage('Server status refreshed.'); });
    const transition = (action, payload = {}) => operate(async () => {
      const signature = JSON.stringify([record.listingId, record.version, action, payload]);
      if (!attempts.current.has(signature)) attempts.current.set(signature, crypto.randomUUID());
      accept(await service.action(record, action, payload, attempts.current.get(signature))); setRenewal(false); setMessage('Saved by the listing service. Spreadsheet tracking may still be pending.');
      // Reload authoritative history and canonical price before another action.
      accept(await service.get(record.listingId));
    });
    const button = (label, onClick, disabled = false, main = false) => h('button', { type: 'button', onClick, disabled: busy || disabled, className: main ? primary : secondary }, label);
    const input = (id, label, value, change, extra = {}) => h('div', { className: 'dh-owner-field' }, h('label', { htmlFor: id, className: 'block text-xs font-bold text-stone-700 mb-2' }, label), h('input', { id, value, onChange: e => change(e.target.value), className: control, ...extra }));
    if (!service.ready) return h('p', { className: 'dh-owner-note' }, 'Secure listing submission is not connected yet. Your draft remains on this device; nothing has been submitted or published.');
    return h('section', { className: 'space-y-6', 'aria-label': management ? 'Listing status and actions' : 'Secure listing submission' },
      !signedIn ? h(React.Fragment, null,
        h('p', { className: 'dh-owner-hint' }, 'Sign in with the one-time link in your email. If your email contains a code instead, you can enter it below.'),
        input('dh-listing-signin-email', 'Account email', email, setEmail, { type: 'email', autoComplete: 'email' }),
        button('Send sign-in email', () => operate(async () => { await service.sendCode(email); setSent(true); setMessage('If email delivery is configured for this address, follow the one-time sign-in link. If your email contains a code, enter it below.'); }), !email),
        sent && input('dh-listing-signin-code', 'Email sign-in code (if shown)', code, setCode, { inputMode: 'numeric', autoComplete: 'one-time-code' }),
        sent && button('Verify code and sign in', () => operate(async () => { await service.verifyCode(email, code); setCode(''); setMessage('Signed in. Refresh status to check earlier submissions.'); }), !code)) :
      h(React.Fragment, null, !authenticationOnly && button('Refresh submission status', refresh), button('Sign out', () => { service.signOut(); setSignedIn(false); setRecord(null); }),
        !authenticationOnly && management && h(React.Fragment, null, input('dh-listing-status-id', 'Listing ID', lookupId, setLookupId), button('Look up listing', () => operate(async () => { accept(await service.get(lookupId)); }), !lookupId)),
        !authenticationOnly && !management && !record && button('Submit listing for review', () => operate(async () => {
          // Save the stable key before the first network call; the same key survives retry/back navigation.
          const key = draft.submissionRequestKey || crypto.randomUUID();
          onDraftChange(old => ({ ...old, submissionRequestKey: key }));
          accept(await service.submit(draft, key));
          setMessage('Listing stored for review. It is not public. Spreadsheet tracking is pending.');
        }), !valid, true),
        record && h(React.Fragment, null,
          h('p', { role: 'status', className: 'dh-owner-note' }, `Listing ${record.listingId} · ${record.status} · Submitted ${new Date(record.submittedAt).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })} (Asia/Colombo)`),
          record.reviewStatus && h('p', {role:'status',className:'dh-owner-note'}, 'Revision: '+record.reviewStatus+' · The approved public version is retained until approval.'),
          record.reviewNotes && h('p', {className:'dh-owner-note'}, 'Reviewer notes: '+record.reviewNotes),
          record.duplicateCandidates?.length > 0 && record.reviewer && h('p', {className:'dh-owner-note'}, 'Possible duplicate properties — review rather than automatically reject: '+record.duplicateCandidates.join(', ')),
          record.expiresAt && h('p', { className: 'dh-owner-hint' }, `Current period ends ${new Date(record.expiresAt).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })} (Asia/Colombo). Edits and pausing do not extend this date.`),
          record.publicationUrl && h('a', { href: record.publicationUrl, className: 'text-emerald-900 underline' }, 'View listing'),
          record.editable !== false && !['withdrawn','sold','rented','declined'].includes(record.status) && !management && button('Submit updated listing for review', () => transition('edit', { draft }), !valid),
          record.editable !== false && !['withdrawn','sold','rented','declined'].includes(record.status) && button('Withdraw listing', () => transition('withdraw')),
          record.editable !== false && ['published', 'paused', 'expired'].includes(record.status) && h('div', { className: 'dh-owner-edit-links' },
            record.status === 'published' && button('Pause listing', () => transition('pause')),
            record.status === 'paused' && button('Resume current period', () => transition('resume')),

            button(draft.selection.listingPurpose === 'buy' ? 'Mark sold' : 'Mark rented', () => transition(draft.selection.listingPurpose === 'buy' ? 'sold' : 'rented')),
            h('label', { className: 'dh-owner-checkbox' }, h('input', { type: 'checkbox', checked: renewal, onChange: e => setRenewal(e.target.checked) }), `I confirm that the property is available and the current price remains ${record.currentCurrency || record.draft?.currency || draft.currency} ${record.currentPrice || record.draft?.price || draft.price}. I confirm that I remain authorised to advertise it and request a new one-calendar-month period.`),
            button('Confirm renewal', () => transition('renew', { priceConfirmed: true, available: true, renewalConsent: true, authorityConfirmed: true, price: Number(record.currentPrice || record.draft?.price || draft.price), currency: record.currentCurrency || record.draft?.currency || draft.currency }), !renewal)),
          record.reviewer && h('div', { className: 'space-y-6' }, input('dh-listing-review-reason', 'Review notes / reason', reason, setReason), h('div', { className: 'dh-owner-edit-links' }, ( (record.reviewStatus || record.status) === 'submitted' ? ['needs_changes', 'approve', 'decline'] : (record.reviewStatus || record.status) === 'approved' ? ['publish'] : [] ).map(action => h(React.Fragment, { key: action }, button(action.replaceAll('_', ' '), () => transition(action, { reason })))))),
          record.reviewer && record.submittingAgentId && h('div', {className:'space-y-4'}, input('dh-listing-assignee', 'Assigned agent reference', assignedAgentId, setAssignedAgentId), button('Reassign listing contact', () => transition('reassign', {assignedAgentId, reason}), !assignedAgentId)),
          record.history && h('ol', { className: 'space-y-2 text-xs' }, record.history.map((item, index) => h('li', { key: index }, `${item.action} · ${item.actor} · ${new Date(item.at).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })}`))))),
      message && h('p', { role: 'status', 'aria-live': 'polite', className: 'dh-owner-note' }, message));
  };
}
