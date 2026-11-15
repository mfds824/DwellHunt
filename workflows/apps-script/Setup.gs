/* One-time setup helpers, run by hand from the Apps Script editor. They change nothing. */

/** Run this from the editor after the Cloud project link or a new permission: Google shows the approval
 *  screen, then this reports whether the Meet API can be reached (404 = ready, 403 = not yet). */
function authorizeDwellHunt() {
  const result = dhMeetReadiness_();
  console.log('Meet API status: ' + result.meet_api_status + ' (404 means ready). Open meetings switched on: ' + result.open_access_enabled);
  return result;
}
