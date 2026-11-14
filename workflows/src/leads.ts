import { JWT } from "google-auth-library";
import { required, type Payload } from "./gateway";

export function scoreLead(input: Payload) {
  const get = (...keys: string[]) => {
    for (const key of keys) if (input[key] !== undefined && input[key] !== null) return String(input[key]).trim();
    return "";
  };
  const email = get("email").toLowerCase(), phone = get("phone");
  if (!email && !phone) throw new Error("Email or phone is required");
  const lead = {
    customer_name: get("customer_name", "name"), email, phone,
    enquiry_type: get("enquiry_type"), property: get("property"), location: get("location"),
    budget: get("budget"), message: get("message"), source: get("source") || "website",
    submittedAt: get("submittedAt") || new Date().toISOString(), lead_status: "new",
    follow_up_date: get("follow_up_date"), lead_id: email || phone,
  };
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => { score += points; reasons.push(reason); };
  if (lead.budget && lead.budget !== "0") add(20, "Budget provided");
  if (lead.location) add(15, "Location specified");
  if (lead.property) add(15, "Property specified");
  if (["buy", "rent", "purchase", "lease"].some(w => lead.enquiry_type.toLowerCase().includes(w))) add(10, "Clear enquiry type");
  if (/\b(urgent|asap|immediately|today|this week|ready to buy|ready to rent)\b/i.test(lead.message)) add(30, "High urgency");
  else if (/\b(soon|next month|viewing|visit|schedule)\b/i.test(lead.message)) add(15, "Moderate urgency");
  add(10, "Contact information available");
  const priority = score >= 75 ? "HOT" : score >= 40 ? "WARM" : "COLD";
  return { ...lead, ai_lead_score: score, ai_lead_priority: priority,
    ai_lead_reason: reasons.join("; "), ai_analyzed_at: new Date().toISOString(),
    ai_next_action: priority === "HOT" ? "Contact customer promptly and arrange a viewing." :
      priority === "WARM" ? "Send matching properties and follow up." : "Request missing requirements and nurture lead." };
}

export async function telegram(text: string) {
  const response = await fetch(`https://api.telegram.org/bot${required("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: required("TELEGRAM_CHAT_ID"), text }), signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok || (await response.json() as {ok?: boolean}).ok !== true) throw new Error("Telegram notification failed");
}

export async function saveLead(payload: Payload) {
  const lead = scoreLead(payload);
  const auth = new JWT({ email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: required("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const token = await auth.getAccessToken();
  if (!token.token) throw new Error("Google authentication failed");
  const headers = { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" };
  const sheet = "'" + required("GOOGLE_CRM_SHEET_NAME").replace(/'/g, "''") + "'";
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(required("GOOGLE_SHEET_ID"))}/values/`;
  const response = await fetch(base + encodeURIComponent(sheet + "!A:AZ"), { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("Could not read CRM sheet");
  const { values = [] } = await response.json() as { values?: string[][] };
  const columns = values[0] || [];
  const expected = ["Date", "Customer Name", "Phone", "Email", "Customer Type", "Preferred Location", "Budget", "Lead Status",
    "Ai lead score", "Ai lead priority", "Ai lead reason", "Ai next action", "Ai analyzed at"];
  if (expected.some(c => !columns.includes(c))) throw new Error("CRM sheet headers do not match the exported workflow");
  const emailIndex = columns.indexOf("Email"), phoneIndex = columns.indexOf("Phone");
  const duplicate = values.slice(1).some(row => lead.email
    ? String(row[emailIndex] || "").trim().toLowerCase() === lead.email
    : String(row[phoneIndex] || "").trim() === lead.phone);
  if (duplicate) return { duplicate: true, priority: lead.ai_lead_priority };
  const mapped: Payload = { Date: lead.submittedAt, "Customer Name": lead.customer_name, Phone: lead.phone,
    Email: lead.email, "Customer Type": lead.enquiry_type, "Preferred Location": lead.location, Budget: lead.budget,
    "Lead Status": lead.lead_status, "Ai lead score": lead.ai_lead_score, "Ai lead priority": lead.ai_lead_priority,
    "Ai lead reason": lead.ai_lead_reason, "Ai next action": lead.ai_next_action, "Ai analyzed at": lead.ai_analyzed_at };
  const append = await fetch(base + encodeURIComponent(sheet + "!A:AZ") + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", {
    method: "POST", headers, body: JSON.stringify({ values: [columns.map(c => mapped[c] ?? "")] }), signal: AbortSignal.timeout(30_000),
  });
  if (!append.ok) throw new Error("Could not append CRM lead");
  const text = lead.ai_lead_priority === "HOT"
    ? `🔥 DWELLHUNT HOT LEAD\nName: ${lead.customer_name}\nEmail: ${lead.email}\nBudget: ${lead.budget}\nScore: ${lead.ai_lead_score}\nNext: ${lead.ai_next_action}`
    : `🏠 DwellHunt ${lead.ai_lead_priority} lead: ${lead.customer_name} | ${lead.email}`;
  await telegram(text);
  return { duplicate: false, priority: lead.ai_lead_priority };
}
