// Registration wording for Survivor (7 Nov 2026), copied word for word
// from the organiser's own form (screenshots received 2026-10-07).
//
// WORDING_VERSION is saved with every registration, so it is always
// possible to show exactly which text a team agreed to. Change the
// version whenever any wording below changes.
//
// Items marked CONFIRM were cut off in the screenshots: the start is
// the organiser's wording, the ending is a placeholder to be replaced
// with the full sentence before registration opens.

export const WORDING_VERSION = "survivor-2026-v1-draft";

export type LegalSection = {
  key: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  closing?: string[];
};

export const MEDICAL_INTRO: LegalSection = {
  key: "medical_information",
  title: "Medical information",
  paragraphs: [
    "The following information is requested for safety and emergency-response purposes.",
    "Please provide accurate information. If you do not know an answer, indicate “Unknown” rather than guessing.",
    "Medical information will be treated as confidential and should only be accessible to persons who reasonably require it for event safety, emergency response, medical care, administration or other lawful purposes.",
  ],
};

/**
 * Medical questions. CONFIRM: the organiser's own question list was not in
 * the screenshots - this is a draft for the organiser (a physiotherapist)
 * to correct. Each is answered Yes / No / Unknown, per the wording above.
 */
export const MEDICAL_QUESTIONS: { key: string; label: string }[] = [
  { key: "heart", label: "Heart condition, chest pain or fainting during exercise" },
  { key: "blood_pressure", label: "High blood pressure" },
  { key: "asthma", label: "Asthma or other breathing problems" },
  { key: "diabetes", label: "Diabetes" },
  { key: "epilepsy", label: "Epilepsy or seizures" },
  { key: "recent_injury", label: "Injury or surgery in the last 6 months" },
  { key: "pregnant", label: "Pregnant" },
  { key: "allergies", label: "Serious allergies" },
  { key: "medication", label: "Taking chronic medication" },
];

export const MEDICAL_ANSWERS = ["no", "yes", "unknown"] as const;
export type MedicalAnswer = (typeof MEDICAL_ANSWERS)[number];

export const CONSENT_AND_RISK: LegalSection = {
  key: "emergency_medical_consent_and_risk",
  title: "Emergency medical consent and risk",
  paragraphs: [
    "PLEASE REMEMBER TO BRING YOUR MEDICAL INFORMATION WITH, IN CASE YOU NEED MEDICAL ASSISTANCE.",
    "The organisers will take reasonable steps to respond appropriately to illness or injury occurring during the event. Where reasonably necessary, the organisers may request or facilitate first aid, emergency medical assistance, ambulance transportation or referral to a medical facility.",
    "Participation in a physical sporting event involves inherent risks. These risks may include, but are not limited to:",
  ],
  bullets: [
    "strenuous physical exertion;",
    "fatigue;",
    "dehydration;",
    "heat-related illness;",
    "slips, trips and falls;",
    "muscular strains;",
    "sprains;",
    "fractures;",
    "bruising;",
    "cuts and abrasions;",
    "collisions with equipment, obstacles or other participants;",
    "falling or loss of balance;",
    "equipment malfunction or failure;",
    "aggravation of an existing injury or medical condition;",
    "cardiovascular or other medical emergencies;",
    "injury resulting from the actions of another participant;",
    "risks associated with the venue;",
    "risks arising from weather or environmental conditions; and",
    "other risks inherent in participation in a physical sporting event.",
  ],
  closing: [
    "The organisers will take reasonable measures to reduce foreseeable risks and provide appropriate event procedures and safety measures. However, it is not possible to eliminate every risk associated with participation.",
  ],
};

export const PRIVACY: LegalSection = {
  key: "privacy_and_medical_information",
  title: "Privacy and medical information",
  paragraphs: [
    "The organisers collect personal information in order to administer the event, communicate with participants, manage safety and emergencies, verify registration and comply with applicable legal and operational requirements.",
    "Certain information requested in this form, particularly health and medical information, may constitute sensitive/special personal information.",
    "The organisers will take reasonable steps to protect personal information against unauthorised access, loss, misuse or disclosure.",
    "Medical information should only be accessed by organisers, designated safety personnel, medical personnel or other persons who reasonably require the information for legitimate event, emergency, safety, administrative or legal purposes.",
    "Information will be retained only for as long as reasonably necessary for the purposes for which it was collected, subject to applicable legal and operational requirements.",
    // CONFIRM: added by the developer (not in the organiser's screenshots),
    // because athletes' names are shown next to their team on public pages.
    "Your names, team name and race results will be shown publicly on the live results, on the big screen at the venue and on the results page after the event. Contact details and medical information are never shown.",
    // CONFIRM: added by developer
    "We will email your results to the address you gave.",
  ],
};

/** Every athlete ticks each of these. Order matches the organiser's form. */
export const FINAL_DECLARATION: { key: string; text: string; confirm?: boolean }[] = [
  {
    key: "true_and_accurate",
    // CONFIRM ending
    text: "I confirm that the information provided in this registration form is true and accurate to the best of my knowledge.",
    confirm: true,
  },
  {
    key: "withholding_medical",
    // CONFIRM ending
    text: "I understand that withholding relevant medical information may affect the ability of event personnel to respond appropriately in an emergency.",
    confirm: true,
  },
  {
    key: "disclosed_conditions",
    // CONFIRM ending
    text: "I confirm that I have disclosed any medical condition, injury, medication or other relevant information that may affect my safe participation in the event.",
    confirm: true,
  },
  {
    key: "read_rules_and_risk",
    // CONFIRM ending
    text: "I have read and understood the event rules, safety information, medical provisions, assumption of risk and privacy information in this form.",
    confirm: true,
  },
  {
    key: "voluntary",
    text: "I am voluntarily registering to participate in the event.",
  },
  {
    key: "may_ask",
    // CONFIRM ending
    text: "I understand that I may ask the organisers for clarification about any part of this agreement before participating.",
    confirm: true,
  },
  {
    key: "electronic_acknowledgement",
    // CONFIRM ending
    text: "I understand that submitting this form constitutes my electronic acknowledgement and agreement to the terms set out in this registration form.",
    confirm: true,
  },
];

/** Sections each athlete must accept (one tick each) before the declaration. */
export const CONSENT_SECTIONS = [CONSENT_AND_RISK, PRIVACY];
