// Registration wording for Survivor (7 Nov 2026), copied word for word
// from the organiser's form "Athlete registration, medical information,
// consent & participant waiver" (received 2026-10-07).
//
// WORDING_VERSION is saved with every registration, so it is always
// possible to show exactly which text an athlete agreed to. Change the
// version whenever any wording below changes.
//
// Organiser's choices (2026-10-07): every question asked as in the form;
// one tick per section; medical questions answered No / Yes / Unknown.
// Q9 (category) is the team type and Q10 (team number) is the Team ID,
// both filled in automatically.

export const WORDING_VERSION = "survivor-2026-v2";

export const ORGANISER = "The Box and Mission To Move";

export type LegalSection = {
  key: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  closing?: string[];
  /** Statements the athlete agrees to with the section's one tick. */
  statements?: string[];
};

export const IMPORTANT_INFO: LegalSection = {
  key: "important_information",
  title: "Important information before registering",
  paragraphs: [
    "Participation in this event involves physical activity and may involve strenuous exercise, lifting, carrying, running, jumping, climbing, obstacles, equipment and interaction with other participants.",
    "The organisers will take reasonable steps to provide a safe event environment, appropriate rules, supervision and reasonable emergency procedures. However, no sporting or physical activity can be made completely risk-free.",
    "By registering, the participant confirms that they have read and understood the information in this form and voluntarily agree to the terms applicable to participation.",
    "Please answer all questions honestly and completely. Medical information is collected to assist the organisers and appropriately qualified medical/emergency personnel in responding to an illness or injury during the event.",
  ],
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

export const MEDICAL_ANSWERS = ["no", "yes", "unknown"] as const;
export type MedicalAnswer = (typeof MEDICAL_ANSWERS)[number];

/**
 * Sections 3 and 4 of the form. Each is answered No / Yes / Unknown.
 * `detail` adds the form's optional "If yes, ..." box under the question.
 */
export type MedicalQuestion = {
  key: string;
  label: string;
  group: "medical" | "injuries";
  detail?: { key: string; label: string; hint?: string };
};

export const MEDICAL_QUESTIONS: MedicalQuestion[] = [
  {
    key: "medical_condition",
    group: "medical",
    label: "Do you have any medical condition that the organisers or medical personnel should be aware of?",
  },
  {
    key: "allergies",
    group: "medical",
    label: "Do you have any allergies?",
    detail: {
      key: "allergies",
      label: "If yes, please list your allergies and describe the reaction.",
      hint: "Example: medication, food, insect bites, latex, etc.",
    },
  },
  {
    key: "medication",
    group: "medical",
    label: "Do you currently take any medication that medical personnel should know about?",
    detail: { key: "medication", label: "If yes, please provide the medication name and relevant information." },
  },
  { key: "asthma", group: "medical", label: "Do you have asthma or another respiratory condition?" },
  { key: "diabetes", group: "medical", label: "Do you have diabetes?" },
  {
    key: "seizure",
    group: "medical",
    label: "Have you ever experienced a seizure, fainting episode or unexplained loss of consciousness?",
  },
  { key: "heart", group: "medical", label: "Do you have a heart or cardiovascular condition?" },
  { key: "other_condition", group: "medical", label: "Do you have any other medical condition that could affect your participation?" },
  {
    key: "current_injury",
    group: "injuries",
    label: "Are you currently injured or recovering from an injury?",
    detail: { key: "current_injury", label: "If yes, please describe the injury." },
  },
  {
    key: "previous_injury",
    group: "injuries",
    label: "Have you had any previous injury, surgery or medical procedure that may be relevant to participation?",
    detail: { key: "previous_injury", label: "If yes, please provide details." },
  },
  {
    key: "advised_restrict",
    group: "injuries",
    label: "Have you been advised by a medical professional to restrict or avoid strenuous physical activity?",
  },
];

/** Q26 (end of section 3) and Q32 (end of section 4): optional boxes. */
export const MEDICAL_ADDITIONAL = {
  key: "additional",
  label: "Please provide any additional medical information that could assist emergency medical personnel.",
};
export const INJURIES_ANYTHING_ELSE = {
  key: "anything_else",
  label:
    "Is there anything else about your health, fitness or physical condition that you believe the event organisers or medical team should know?",
};

export const INJURIES_TITLE = "Injuries & physical readiness";

export const MEDICAL_AID: LegalSection = {
  key: "medical_aid",
  title: "Medical aid / insurance",
  paragraphs: [
    "Providing this information is intended to assist emergency personnel where reasonably necessary. It does not replace the athlete’s responsibility to carry any required medication or medical documentation.",
  ],
};

export const EMERGENCY_MEDICAL_CONSENT: LegalSection = {
  key: "emergency_medical_consent",
  title: "Emergency medical consent",
  paragraphs: [
    "The organisers will take reasonable steps to respond appropriately to illness or injury occurring during the event.",
    "Where reasonably necessary, the organisers may request or facilitate first aid, emergency medical assistance, ambulance transportation or referral to a medical facility.",
  ],
  statements: [
    "I authorise the organisers and/or appropriately qualified emergency personnel to provide or arrange reasonable first aid and emergency medical assistance if I become ill or injured during the event.",
    "I understand that the organisers are not medical practitioners and that medical treatment decisions will be made by appropriately qualified medical personnel.",
    "I understand that emergency transportation or treatment may result in costs for which I may be responsible, subject to applicable law and my medical aid/insurance arrangements.",
  ],
};

export const ASSUMPTION_OF_RISK: LegalSection = {
  key: "assumption_of_risk",
  title: "Participant assumption of risk",
  paragraphs: [
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
  statements: [
    "I understand that participation in this event involves inherent risks of injury, illness and, in exceptional circumstances, serious injury or death.",
    "I voluntarily choose to participate despite these inherent risks.",
    "I accept responsibility for reasonably assessing my own ability to participate safely and for informing the organisers of relevant medical conditions or injuries.",
    "I understand that I may withdraw from participation if I feel unable to safely continue.",
  ],
};

export const RESPONSIBILITIES: LegalSection = {
  key: "participant_responsibilities",
  title: "Organiser safety & participant responsibilities",
  paragraphs: [],
  statements: [
    "I agree to follow all event rules and safety instructions.",
    "I agree to follow instructions given by event officials, marshals, judges, medical personnel and safety personnel.",
    "I will use equipment only as instructed.",
    "I will not intentionally place another participant or event official at unnecessary risk.",
    "I will immediately report an injury, medical problem or unsafe condition to an event official.",
    "I understand that the organisers may stop or restrict my participation where they reasonably believe that continuing may create a safety risk to me or another person.",
    "I understand that failure to follow event rules or safety instructions may result in removal from the event.",
  ],
};

export const LIABILITY: LegalSection = {
  key: "liability_and_release",
  title: "Liability & release",
  paragraphs: [
    "To the extent permitted by applicable law, the participant acknowledges that participation in the event carries inherent risks and agrees to accept responsibility for those inherent risks.",
    "The participant agrees that the organisers, venue owners/operators, event staff, officials, volunteers, contractors and service providers should not be held liable for loss, injury, damage or expense arising from an inherent risk of participation or from the participant’s own acts or omissions, except to the extent that such liability cannot lawfully be excluded or limited.",
    "Nothing in this agreement is intended to exclude or limit any liability, right or protection that cannot lawfully be excluded or limited under applicable South African law.",
  ],
  statements: [
    "I have read and understood the above liability and risk provisions.",
    "I understand that the organisers cannot guarantee that participation will be completely free from risk.",
    "I accept the inherent risks associated with participation, to the extent permitted by law.",
    "I understand that this agreement does not remove any legal rights or protections that cannot lawfully be excluded.",
  ],
};

export const PRIVACY: LegalSection = {
  key: "privacy",
  title: "Medical information & privacy",
  paragraphs: [
    "The organisers collect personal information in order to administer the event, communicate with participants, manage safety and emergencies, verify registration and comply with applicable legal and operational requirements.",
    "Certain information requested in this form, particularly health and medical information, may constitute sensitive/special personal information.",
    "The organisers will take reasonable steps to protect personal information against unauthorised access, loss, misuse or disclosure.",
    "Medical information should only be accessed by organisers, designated safety personnel, medical personnel or other persons who reasonably require the information for legitimate event, emergency, safety, administrative or legal purposes.",
    "Information will be retained only for as long as reasonably necessary for the purposes for which it was collected, subject to applicable legal and operational requirements.",
    // Added by the developer (not in the organiser's form), because
    // athletes' names are shown next to their team on public pages, and
    // results are emailed. CONFIRM with the organiser.
    "Your names, team name and race results will be shown publicly on the live results, on the big screen at the venue and on the results page after the event. Contact details and medical information are never shown.",
    "We will email your results to the address you gave.",
  ],
  statements: [
    "I understand why my personal and medical information is being collected.",
    "I consent to the processing and use of my personal and medical information for legitimate event registration, administration, safety, emergency-response and related legal purposes.",
    "I understand that relevant medical information may be made available to appropriately qualified medical or emergency personnel if reasonably necessary.",
    "I understand that the organisers will take reasonable measures to protect my information.",
  ],
};

/** Section 11: a free choice, separate from the waiver. */
export const PHOTO_CONSENT = {
  key: "photo_consent",
  title: "Photography & video",
  yes: "Yes, I consent to photographs and/or video recordings of me being used for legitimate event promotion, marketing and social media.",
  no: "No, I do not consent to promotional use of photographs/video of me.",
};

export const FINAL_DECLARATION_SECTION: LegalSection = {
  key: "final_declaration",
  title: "Final participant declaration",
  paragraphs: ["Please read the following declaration carefully before submitting your registration."],
  statements: [
    "I confirm that the information provided in this registration form is true and accurate to the best of my knowledge.",
    "I understand that withholding relevant medical information may affect the ability of event personnel to respond appropriately in an emergency.",
    "I confirm that I have disclosed any medical condition, injury, medication or other relevant information that may reasonably affect my participation.",
    "I have read and understood the event rules, safety information, medical provisions, assumption of risk and liability provisions contained in this form.",
    "I am voluntarily registering to participate in the event.",
    "I understand that I may ask the organisers for clarification about any part of this agreement before participating.",
    "I understand that submitting this form constitutes my electronic acknowledgement and agreement to the applicable terms contained in this registration form, subject to applicable law.",
  ],
};

/** Sections accepted with one tick each (sections 6 to 10). */
export const CONSENT_SECTIONS: LegalSection[] = [
  EMERGENCY_MEDICAL_CONSENT,
  ASSUMPTION_OF_RISK,
  RESPONSIBILITIES,
  LIABILITY,
  PRIVACY,
];

/** Every key that must be ticked (true) in an athlete's consents. */
export const REQUIRED_TICKS: string[] = [...CONSENT_SECTIONS.map((s) => s.key), FINAL_DECLARATION_SECTION.key];
