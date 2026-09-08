/**
 * The fixture set.
 *
 * Every fixture carries two text variants of the SAME information:
 *
 *   naive  - the raw string a backend system would emit into a TTS call
 *   ear    - the same information rewritten for the ear
 *
 * Both variants are sent to Rime with an identical modelId, speaker and lang
 * (see src/voice.mjs). That is what makes the comparison a controlled one:
 * the only thing that varies between the two clips is the characters in `text`.
 *
 * `target` is the plain-language pronunciation we are aiming for. It is the
 * reference a listener checks the audio against. It is written by hand, it is
 * not produced by Rime, and it is not evidence of anything on its own.
 *
 * `track` says which (model, language, speaker) combination renders this
 * fixture. Both variants use that same track, which is what holds the model,
 * voice and language constant inside the pair. Tracks differ in which controls
 * they support, and a fixture may only use techniques its track was measured
 * to honour. See src/voice.mjs, and the preflight check that enforces it.
 *
 * `technique` names the Rime mechanism the ear variant leans on:
 *
 *   normalizer-format  - reshape the string into a pattern Rime's text
 *                        normalizer already recognises, e.g. (415) 555-2671
 *   spell()            - the one inline directive Rime supports; reads a token
 *                        letter and digit at a time
 *   phoneme            - phonemizeBetweenBrackets, Rime's own IPA-inspired
 *                        alphabet inside curly braces. Mist v1 / v2 only, so
 *                        the Hindi track cannot use it
 *   expand             - write the abbreviation out as the word it stands for
 *   pacing             - commas and sentence breaks used as prosody control
 *
 * HONESTY NOTE ON `phoneme` FIXTURES
 * The bracketed phoneme strings below are hand-authored from Rime's published
 * alphabet. They are a hypothesis about how to say these names, not a verified
 * result. Whether they actually sound closer to `target` than the naive variant
 * is exactly the thing the artifact asks you to listen for and record.
 */

export const TECHNIQUES = {
  'normalizer-format': 'Reshaped into a pattern Rime’s normalizer recognises',
  'spell()': 'spell() reads the token letter and digit at a time',
  phoneme: 'phonemizeBetweenBrackets, Rime’s phonetic alphabet',
  expand: 'Abbreviation written out as the word it stands for',
  pacing: 'Commas and sentence breaks used as prosody control',
};

export const CATEGORIES = {
  name: 'Proper name',
  phone: 'Phone number',
  address: 'Address',
  code: 'Reference code',
};

export const FIXTURES = [
  // ---------------------------------------------------------------- names
  {
    id: 'name-doheny',
    track: 'en-US',
    category: 'name',
    label: 'Irish given name',
    naive: 'Hi Siobhán Doheny, your Thursday appointment is confirmed.',
    ear: 'Hi {S0Iv1an} {d1oh0xn0i}, your Thursday appointment is confirmed.',
    target: 'shiv-AWN DOH-uh-nee',
    technique: ['phoneme'],
    note:
      'Siobhán is spelled nothing like it sounds under English letter-to-sound ' +
      'rules. There is no formatting trick that fixes this one. It needs phonemes.',
    stress: false,
  },
  {
    id: 'name-xochitl',
    track: 'en-US',
    category: 'name',
    label: 'Nahuatl-derived given name',
    naive: 'Hi Xochitl Reyna, your prescription is ready for pickup.',
    ear: 'Hi {s1oC0il} {r1en0x}, your prescription is ready for pickup.',
    target: 'SO-cheel RAY-nah',
    technique: ['phoneme'],
    note:
      'Common across the US Southwest and routinely read as "zoh-chittle" by ' +
      'English-first models. The leading X is an s sound.',
    stress: false,
  },
  {
    id: 'name-wojciechowski',
    track: 'en-US',
    category: 'name',
    label: 'Polish surname',
    naive: 'Krzysztof Wojciechowski, your delivery window has moved.',
    ear: '{kS1ISt0af} {v2OC0Eh1afsk0i}, your delivery window has moved.',
    target: 'KSHISH-tof voy-cheh-HOF-skee',
    technique: ['phoneme'],
    note:
      'Nine consonants and three vowels. English letter-to-sound rules produce ' +
      'something the person being called will not recognise as their own name.',
    stress: false,
  },

  // --------------------------------------------------------------- phones
  {
    id: 'phone-raw',
    track: 'en-US',
    category: 'phone',
    label: 'Unformatted 10-digit number',
    naive: 'Call us back at 4155552671.',
    ear: 'Call us back at (415) 555-2671.',
    target: 'four one five, five five five, two six seven one',
    technique: ['normalizer-format'],
    note:
      'Rime’s normalizer recognises (213) 555-9274 as a phone number. A bare ' +
      'run of ten digits carries no such signature.',
    stress: true,
    stressWhy:
      'Backends store phone numbers unformatted, so this is the string a naive ' +
      'integration actually sends. Ten digits with no separators are a number in ' +
      'the billions, not a phone number. The customer cannot write it down and ' +
      'cannot dial it back.',
  },
  {
    id: 'phone-ext',
    track: 'en-US',
    category: 'phone',
    label: 'E.164 number with extension',
    naive: 'Reach the clinic on +1-628-555-0119 ext 4402.',
    ear: 'Reach the clinic on +1 (628) 555-0119, extension 4 4 0 2.',
    target:
      'plus one, six two eight, five five five, oh one one nine, extension four four oh two',
    technique: ['normalizer-format', 'expand', 'pacing'],
    note:
      'Two problems in one string. "ext" is an abbreviation, and the 4402 after ' +
      'it is a digit sequence rather than a quantity of things.',
    stress: false,
  },

  // ------------------------------------------------------------ addresses
  {
    id: 'address-apt',
    track: 'en-US',
    category: 'address',
    label: 'Street address with unit',
    naive: 'Delivering to 1247 Alameda St Apt 4B between 2 and 4pm.',
    ear: 'Delivering to 1247 Alameda Street, apartment 4 B, between 2 and 4pm.',
    target:
      'twelve forty-seven Alameda Street, apartment four B, between two and four PM',
    technique: ['expand', 'pacing'],
    note:
      'The unit designator is the fragile part. 4B run together can surface as ' +
      '"forty-B". A space and a comma separate the number from the letter.',
    stress: false,
  },
  {
    id: 'address-saint',
    track: 'en-US',
    category: 'address',
    label: 'Address where St is not Street',
    naive: 'Your driver is waiting at 9 St Marys Ct, Mt Vernon.',
    ear: 'Your driver is waiting at 9 Saint Mary’s Court, Mount Vernon.',
    target: 'nine Saint Mary’s Court, Mount Vernon',
    technique: ['expand'],
    note:
      'Three abbreviations, and the first one is the trap. Ct is Court and Mt is ' +
      'Mount, but St here is Saint, which is the reading a street-address ' +
      'normalizer is least likely to choose.',
    stress: true,
    stressWhy:
      'This is the failure that does not sound like a failure. "Nine Street ' +
      'Marys Court" is fluent, confident and wrong. Nothing in the audio signals ' +
      'a problem, so the customer writes down a plausible address and goes to the ' +
      'wrong place.',
  },

  // ---------------------------------------------------------------- codes
  {
    id: 'code-order',
    track: 'en-US',
    category: 'code',
    label: 'Short alphanumeric order code',
    naive: 'Your order code is A7X4B9.',
    ear: 'Your order code is spell(A7X4B9).',
    target: 'A, seven, X, four, B, nine',
    technique: ['spell()'],
    note:
      'spell() is the only inline directive Rime supports, and this is what it is ' +
      'for. It also inserts the grouping pauses a listener needs to copy it down.',
    stress: false,
  },
  {
    id: 'code-po',
    track: 'en-US',
    category: 'code',
    label: 'Purchase order with a year-shaped run',
    naive: 'Purchase order PO-2004-EN has been approved.',
    ear: 'Purchase order spell(PO2004EN) has been approved.',
    target: 'P O, two zero zero four, E N',
    technique: ['spell()'],
    note:
      'The digits look like a year and the letter pairs look like words. Left ' +
      'alone this can come out as "po two thousand four en".',
    stress: false,
  },
  {
    id: 'code-rx',
    track: 'en-US',
    category: 'code',
    label: 'Prescription reference with a leading zero',
    naive: 'Prescription RX0-8821-QN is ready.',
    ear: 'Prescription spell(RX08821QN) is ready.',
    target: 'R X zero, eight eight two one, Q N',
    technique: ['spell()'],
    note:
      'Leading zeros are the ones that vanish. A zero read as part of a quantity ' +
      'rather than as a character makes the reference unusable at the counter.',
    stress: false,
  },

  // ==================================================================
  // Indian English. Mist v2 with an Indian-accent English speaker.
  //
  // This is the common real deployment: an Indian business calling Indian
  // customers with an English voice. The data is Indian, the language is not.
  // Same full toolkit as the US track, because it is the same model.
  // ==================================================================
  {
    id: 'in-name-krishnamurthy',
    track: 'en-IN',
    category: 'name',
    label: 'South Indian name',
    naive: 'Good morning Venkataraman Krishnamurthy, your policy renewal is due.',
    ear:
      'Good morning {v2Enk0xt1arxm0xn} {kr0ISn0xm1RT0i}, your policy renewal is due.',
    target: 'ven-kuh-TAA-ruh-mun krish-nuh-MUR-thee',
    technique: ['phoneme'],
    note:
      'Six syllables then five. English letter-to-sound rules break both, and ' +
      'the stress lands in the wrong place even when the individual sounds are close.',
    stress: false,
  },
  {
    id: 'in-phone-mobile',
    track: 'en-IN',
    category: 'phone',
    label: 'Indian mobile number, unformatted',
    naive: 'Call us on +919876543210 for any changes.',
    ear: 'Call us on +91 98765 43210 for any changes.',
    target: 'plus nine one, nine eight seven six five, four three two one zero',
    technique: ['normalizer-format', 'pacing'],
    note:
      'Indian mobile numbers are spoken as two groups of five, not the three ' +
      'groups a North American normalizer is tuned for. The country code has to ' +
      'separate as well, or it is absorbed into the first group.',
    stress: true,
    stressWhy:
      'Twelve digits with no separator at all. This is what the database column ' +
      'holds and what a naive integration sends. There is no country where a ' +
      'listener can take down a twelve digit cardinal number by ear.',
  },
  {
    id: 'in-address-bengaluru',
    track: 'en-IN',
    category: 'address',
    label: 'Indian address with a PIN code',
    naive: 'Delivering to 12/A, MG Rd, Nr Jayanagar 4th Blk, Bengaluru 560011.',
    ear:
      'Delivering to number 12 A, M G Road, near Jayanagar 4th Block, ' +
      'Bengaluru, PIN code 5 6 0 0 1 1.',
    target:
      'number twelve A, M G Road, near Jayanagar fourth Block, Bengaluru, ' +
      'PIN code five six zero zero one one',
    technique: ['expand', 'pacing'],
    note:
      'Four problems in one line: the slash in 12/A, the initialism MG, two ' +
      'abbreviations a US-tuned normalizer has never seen (Nr, Blk), and a six ' +
      'digit PIN that must not become a quantity.',
    stress: false,
  },
  {
    id: 'in-code-gstin',
    track: 'en-IN',
    category: 'code',
    label: 'GSTIN, fifteen mixed characters',
    naive: 'Your invoice is filed under GSTIN 29ABCDE1234F1Z5.',
    ear: 'Your invoice is filed under GSTIN spell(29ABCDE1234F1Z5).',
    target: 'two nine, A B C D E, one two three four, F, one, Z, five',
    technique: ['spell()'],
    note:
      'A GSTIN is fifteen characters alternating between digits and letters. ' +
      'Every run of digits in it is an identifier, never a quantity, and the ' +
      'letter blocks are not words.',
    stress: false,
  },

  // ==================================================================
  // Hindi. Arcana, because Mist v2 carries no Hindi voices.
  //
  // SMALLER TOOLKIT, AND NOT BY CHOICE.
  // phonemizeBetweenBrackets has no measurable effect on Arcana, so no Hindi
  // fixture uses phonemes. spell() WAS verified to work here, and to be read
  // aloud as a literal word on Coda, which is why this track is not on Coda.
  // `npm run preflight` fails if any fixture uses a technique its track does
  // not support, so this constraint cannot rot silently.
  //
  // `translation` exists so a judge who does not read Devanagari can still
  // follow what is said and check it against the target.
  // ==================================================================
  {
    id: 'hi-phone-callback',
    track: 'hi-IN',
    category: 'phone',
    label: 'Hindi callback number',
    naive: 'आपका ऑर्डर तैयार है। पुष्टि के लिए 9876543210 पर कॉल करें।',
    ear: 'आपका ऑर्डर तैयार है। पुष्टि के लिए, 98765 43210 पर कॉल करें।',
    target:
      'digit by digit, two groups of five: nau aath saat chhe paanch, ' +
      'chaar teen do ek shoonya',
    translation: 'Your order is ready. To confirm, call 98765 43210.',
    technique: ['normalizer-format', 'pacing'],
    note:
      'The same unformatted-number failure as the English tracks, in a language ' +
      'whose large numbers are built on lakh and crore rather than thousand and ' +
      'million, so a misread is even harder to unpick by ear.',
    stress: false,
  },
  {
    id: 'hi-code-booking',
    track: 'hi-IN',
    category: 'code',
    label: 'Hindi booking reference',
    naive: 'आपका बुकिंग कोड RJ4821K है। यात्रा के समय यह कोड बताएं।',
    ear: 'आपका बुकिंग कोड spell(RJ4821K) है। यात्रा के समय यह कोड बताएं।',
    target: 'R J, four eight two one, K',
    translation:
      'Your booking code is RJ4821K. Please quote this code when travelling.',
    technique: ['spell()'],
    note:
      'Latin-script characters inside a Devanagari sentence. spell() was ' +
      'verified on this model before the fixture was written. On Coda, the other ' +
      'Hindi model in the catalog, the directive is spoken aloud as a word.',
    stress: false,
  },
  {
    id: 'hi-address-delhi',
    track: 'hi-IN',
    category: 'address',
    label: 'Hindi address with a PIN code',
    naive: 'डिलीवरी का पता 45/B, सेक्टर 12, द्वारका, नई दिल्ली 110078 है।',
    ear:
      'डिलीवरी का पता, मकान नंबर 45 बी, सेक्टर 12, द्वारका, नई दिल्ली, ' +
      'पिन कोड 1 1 0 0 7 8 है।',
    target:
      'makaan number paintaalis bee, sector baarah, Dwarka, New Delhi, ' +
      'PIN code ek ek shoonya shoonya saat aath',
    translation:
      'The delivery address is house number 45 B, Sector 12, Dwarka, New Delhi, ' +
      'PIN code 1 1 0 0 7 8.',
    technique: ['expand', 'pacing'],
    note:
      'The Latin B and the slash both need help, and the six digit PIN has to ' +
      'stay a sequence of characters rather than collapsing into one number.',
    stress: false,
  },
];

/** Both variants of every fixture, flattened. This is the render queue. */
export function renderQueue() {
  const out = [];
  for (const f of FIXTURES) {
    out.push({ fixtureId: f.id, track: f.track, variant: 'naive', text: f.naive });
    out.push({ fixtureId: f.id, track: f.track, variant: 'ear', text: f.ear });
  }
  return out;
}

export function fixtureById(id) {
  return FIXTURES.find((f) => f.id === id);
}

export const STRESS_CASES = FIXTURES.filter((f) => f.stress);
