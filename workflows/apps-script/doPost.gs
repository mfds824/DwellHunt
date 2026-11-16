// LOCAL DRAFT: replace the existing doPost only; keep all booking helpers.
// Do not add a second doPost function to the Apps Script project.
function doPost(e) {
  var result = dhHandlePost_(e);
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function dhHandlePost_(e) {
  var lock;
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string' ||
        e.postData.contents.length > 40000) fail('INVALID_BODY', 400);
    var p;
    try { p = JSON.parse(e.postData.contents); }
    catch (parseError) { fail('INVALID_JSON', 400); }
    if (!p || typeof p !== 'object' || Array.isArray(p)) fail('INVALID_JSON', 400);
    if (!equal(p.gatewaySecret, cfg('GATEWAY_SECRET'))) fail('UNAUTHORIZED', 401);
    lock = LockService.getScriptLock();
    if (!lock.tryLock(1500)) fail('BUSY_RETRY', 503);
    var r;
    if (p.action === 'intake') r = intake(p.payload || {});
    else if (p.action === 'telegram') r = agentAction(p.payload || {});
    else if (p.action === 'customer_action') r = customerAction(p.payload || {});
    else if (p.action === 'reminders') r = tick(false);
    else if (p.action === 'followup') r = tick(true);
    else fail('INVALID_ACTION', 400);
    return Object.assign({ok: true, httpStatus: 200}, r);
  } catch (error) {
    var isPublic = error && typeof error.publicCode === 'string' &&
      /^[A-Z][A-Z0-9_]{0,79}$/.test(error.publicCode);
    var diagnostic = dhDiagnosticCode_(error);
    // Neither raw messages, stack traces, requests nor credentials are recorded.
    try { log('', isPublic ? error.publicCode : diagnostic); } catch (loggingError) {}
    return {
      ok: false,
      httpStatus: isPublic && error.httpStatus >= 400 && error.httpStatus <= 599 ? error.httpStatus : 503,
      code: isPublic ? error.publicCode : 'SERVICE_UNAVAILABLE',
      diagnostic_code: isPublic ? undefined : diagnostic,
      fields: isPublic ? error.fields : undefined
    };
  } finally {
    // A cleanup exception must not replace the booking result or rejection.
    if (lock) {
      try { if (lock.hasLock()) lock.releaseLock(); }
      catch (releaseError) {
        try { log('', 'LOCK_RELEASE_FAILED'); } catch (loggingError) {}
      }
    }
  }
}

function dhDiagnosticCode_(error) {
  var message = error && typeof error.message === 'string' ? error.message : '';
  var allowed = [
    'PROPERTY_CONFIG', 'CALENDAR_ACCESS_FAILED', 'EVENT_IDENTITY_MISMATCH',
    'TELEGRAM_FAILED', 'UNKNOWN_EMAIL_TEMPLATE'
  ];
  if (allowed.indexOf(message) !== -1) return message;
  if (/^GOOGLE_[1-5][0-9]{2}$/.test(message)) return message;
  var config = ['GATEWAY_SECRET', 'SPREADSHEET_ID', 'TURNSTILE_SECRET',
    'ALLOWED_HOSTNAME', 'TELEGRAM_BOT_TOKEN', 'OPS_CHAT_ID', 'WEBSITE_URL'];
  for (var i = 0; i < config.length; i++) {
    if (message === 'CONFIG_' + config[i]) return 'CONFIG_' + config[i];
  }
  if (error && ['TypeError', 'ReferenceError', 'SyntaxError'].indexOf(error.name) !== -1)
    return 'GATEWAY_' + error.name.toUpperCase();
  return 'GATEWAY_UNEXPECTED_ERROR';
}
