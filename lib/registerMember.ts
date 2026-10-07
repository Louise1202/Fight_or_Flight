// SERVER-SIDE check of one athlete's registration answers, shared by
// sign-up (app/api/register) and the second athlete signing later
// (app/api/register/sign). Error messages never contain the data itself.
import {
  INJURIES_ANYTHING_ELSE,
  MEDICAL_ADDITIONAL,
  MEDICAL_ANSWERS,
  MEDICAL_QUESTIONS,
  REQUIRED_TICKS,
  WORDING_VERSION,
  type MedicalAnswer,
} from "@/lib/legal/survivor";
import {
  ADDRESS_MAX,
  DETAILS_MAX,
  NAME_MAX,
  SHORT_MAX,
  cleanDateOfBirth,
  cleanEmail,
  cleanIdNumber,
  cleanPersonName,
  cleanRelationship,
  cleanText,
  isSignaturePng,
  normaliseAnyPhone,
} from "@/components/register/rules";

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Name, gender, phone, email: all athlete 1 gives for a partner who signs later. */
export type BasicMember = {
  position: 1 | 2;
  first_name: string;
  surname: string;
  gender: "male" | "female";
  phone: string;
  email: string;
};

/** Everything the athlete fills in and signs themselves. */
export type SignedAnswers = {
  preferred_name: string;
  date_of_birth: string;
  id_number: string;
  address: string;
  country: string;
  emergency_name: string;
  emergency_relationship: string;
  emergency_phone: string;
  emergency_phone_alt: string;
  emergency_aware: boolean;
  medical: Record<string, MedicalAnswer>;
  medical_details: string;
  medical_extra: {
    notes: Record<string, string>;
    medical_aid: { has: boolean; provider: string; number: string };
    doctor: { name: string; phone: string };
  };
  consents: { version: string; accepted: Record<string, true>; photo_consent: boolean; accepted_at: string };
  photo_consent: boolean;
  legal_name: string;
  signature_png: string;
};

export function validateBasic(raw: unknown, position: 1 | 2, gender: "male" | "female"): BasicMember | string {
  const who = `Athlete ${position}`;
  if (!isObject(raw)) return `${who}: details are missing.`;
  const first_name = cleanPersonName(raw.first_name);
  if (!first_name) return `${who}: check the first name.`;
  const surname = cleanPersonName(raw.surname);
  if (!surname) return `${who}: check the surname.`;
  if (raw.gender !== gender) return `${who}: the gender doesn't match the team type.`;
  const phone = normaliseAnyPhone(raw.phone);
  if (!phone) return `${who}: enter a valid phone number.`;
  const email = cleanEmail(raw.email);
  if (!email) return `${who}: enter a valid email address.`;
  return { position, first_name, surname, gender, phone, email };
}

function yesNo(v: unknown): boolean | null {
  return v === "yes" ? true : v === "no" ? false : null;
}

function longText(v: unknown): string | null {
  const s = cleanText(v, DETAILS_MAX);
  return s;
}

export function validateSigned(raw: unknown, position: 1 | 2, acceptedAt: string): SignedAnswers | string {
  const who = `Athlete ${position}`;
  if (!isObject(raw)) return `${who}: details are missing.`;

  // Section 1: athlete information.
  const preferred_name = cleanText(raw.preferred_name, NAME_MAX);
  if (preferred_name === null) return `${who}: check the preferred name.`;
  const date_of_birth = cleanDateOfBirth(raw.date_of_birth);
  if (!date_of_birth) return `${who}: check the date of birth.`;
  const id_number = cleanIdNumber(raw.id_number);
  if (!id_number) return `${who}: check the ID or passport number.`;
  const address = cleanText(raw.address, ADDRESS_MAX);
  if (!address) return `${who}: enter a residential address.`;
  const country = cleanText(raw.country, SHORT_MAX);
  if (!country) return `${who}: enter the country of residence.`;

  // Section 2: emergency contact.
  const emergency_name = cleanPersonName(raw.emergency_name);
  if (!emergency_name) return `${who}: check the emergency contact's name.`;
  const emergency_relationship = cleanRelationship(raw.emergency_relationship);
  if (!emergency_relationship) return `${who}: enter the emergency contact's relationship.`;
  const emergency_phone = normaliseAnyPhone(raw.emergency_phone);
  if (!emergency_phone) return `${who}: enter a valid emergency contact number.`;
  let emergency_phone_alt = "";
  if (typeof raw.emergency_phone_alt === "string" && raw.emergency_phone_alt.trim()) {
    const alt = normaliseAnyPhone(raw.emergency_phone_alt);
    if (!alt) return `${who}: check the alternative emergency number.`;
    emergency_phone_alt = alt;
  }
  const emergency_aware = yesNo(raw.emergency_aware);
  if (emergency_aware === null) return `${who}: say whether your emergency contact knows you're taking part.`;

  // Sections 3 and 4: medical, injuries.
  if (!isObject(raw.medical)) return `${who}: answer every medical question.`;
  const medical: Record<string, MedicalAnswer> = {};
  for (const q of MEDICAL_QUESTIONS) {
    const a = raw.medical[q.key];
    if (typeof a !== "string" || !(MEDICAL_ANSWERS as readonly string[]).includes(a)) {
      return `${who}: answer every medical question.`;
    }
    medical[q.key] = a as MedicalAnswer;
  }
  const notesRaw = isObject(raw.notes) ? raw.notes : {};
  const notes: Record<string, string> = {};
  const noteKeys = [
    ...MEDICAL_QUESTIONS.flatMap((q) => (q.detail ? [q.detail.key] : [])),
    INJURIES_ANYTHING_ELSE.key,
  ];
  for (const k of noteKeys) {
    const s = longText(notesRaw[k]);
    if (s === null) return `${who}: medical details can be at most ${DETAILS_MAX} characters each.`;
    if (s) notes[k] = s;
  }
  const medical_details = longText(isObject(raw.notes) ? raw.notes[MEDICAL_ADDITIONAL.key] : "");
  if (medical_details === null) return `${who}: medical details can be at most ${DETAILS_MAX} characters each.`;

  // Section 5: medical aid and doctor.
  const hasAid = yesNo(raw.medical_aid);
  if (hasAid === null) return `${who}: say whether you have medical aid or insurance.`;
  const provider = cleanText(raw.medical_aid_provider, SHORT_MAX);
  const number = cleanText(raw.medical_aid_number, SHORT_MAX);
  const doctorName = cleanText(raw.doctor_name, SHORT_MAX);
  if (provider === null || number === null || doctorName === null) return `${who}: check the medical aid and doctor details.`;
  let doctorPhone = "";
  if (typeof raw.doctor_phone === "string" && raw.doctor_phone.trim()) {
    const p = normaliseAnyPhone(raw.doctor_phone);
    if (!p) return `${who}: check the doctor's contact number.`;
    doctorPhone = p;
  }

  // Sections 6 to 10 and 12: one tick each. Section 11: free choice.
  if (!isObject(raw.consents)) return `${who}: every section must be accepted.`;
  const accepted: Record<string, true> = {};
  for (const key of REQUIRED_TICKS) {
    if (raw.consents[key] !== true) return `${who}: every section must be accepted.`;
    accepted[key] = true;
  }
  const photo_consent = yesNo(raw.photo_consent);
  if (photo_consent === null) return `${who}: choose Yes or No for photographs and video.`;

  // Section 13: electronic signature.
  const legal_name = cleanPersonName(raw.legal_name);
  if (!legal_name) return `${who}: type your full legal name.`;
  if (!isSignaturePng(raw.signature_png)) return `${who}: please sign again.`;

  return {
    preferred_name,
    date_of_birth,
    id_number,
    address,
    country,
    emergency_name,
    emergency_relationship,
    emergency_phone,
    emergency_phone_alt,
    emergency_aware,
    medical,
    medical_details,
    medical_extra: {
      notes,
      medical_aid: { has: hasAid, provider: hasAid ? provider : "", number: hasAid ? number : "" },
      doctor: { name: doctorName, phone: doctorPhone },
    },
    consents: { version: WORDING_VERSION, accepted, photo_consent, accepted_at: acceptedAt },
    photo_consent,
    legal_name,
    signature_png: raw.signature_png,
  };
}
