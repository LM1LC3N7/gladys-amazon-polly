// -----------------------------------------------------------------------------
// Every text shown to the user, in English and French. `{name}` placeholders
// are filled by `t`. No text carries a key, a secret or the spoken text.
// -----------------------------------------------------------------------------

export const ALL_TEXTS = {
  // Status (Configuration screen).
  not_configured: {
    en: 'Enter the access key ID and the secret access key of an IAM user.',
    fr: 'Saisissez l’identifiant de clé d’accès et la clé d’accès secrète d’un utilisateur IAM.',
  },
  key_id_missing: {
    en: 'The access key ID is missing: a secret access key alone is not used.',
    fr: 'L’identifiant de clé d’accès manque : une clé secrète seule n’est pas utilisée.',
  },
  secret_missing: {
    en: 'The secret access key is missing.',
    fr: 'La clé d’accès secrète manque.',
  },
  key_id_invalid: {
    en: 'The access key ID is not valid (upper-case letters and digits, such as AKIA…).',
    fr: 'L’identifiant de clé d’accès n’est pas valide (majuscules et chiffres, comme AKIA…).',
  },
  secret_invalid: {
    en: 'The secret access key is not valid (40 characters, no space).',
    fr: 'La clé d’accès secrète n’est pas valide (40 caractères, sans espace).',
  },
  region_invalid: { en: 'Unknown AWS region.', fr: 'Région AWS inconnue.' },
  engine_invalid: { en: 'Unknown voice engine.', fr: 'Moteur de voix inconnu.' },
  voice_invalid: { en: 'Unknown voice.', fr: 'Voix inconnue.' },
  language_invalid: { en: 'Unknown default language.', fr: 'Langue par défaut inconnue.' },
  rate_invalid: { en: 'Unknown speaking rate.', fr: 'Débit de parole inconnu.' },
  limit_invalid: {
    en: 'The monthly limit must be a whole number between 1,000 and 100,000,000 characters.',
    fr: 'La limite mensuelle doit être un nombre entier de 1 000 à 100 000 000 caractères.',
  },
  config_unread: {
    en: 'The configuration could not be read from Gladys yet; trying again.',
    fr: 'La configuration n’a pas encore pu être lue depuis Gladys ; nouvel essai en cours.',
  },
  ready: {
    en: 'Ready. The keys are checked by AWS at the first announcement or with the Test button.',
    fr: 'Prêt. Les clés sont vérifiées par AWS à la première annonce ou avec le bouton Tester.',
  },
  data_unread: {
    en: 'Ready, but /data cannot be read yet: the monthly limit counts only what was sent since the start (read again every 10 s).',
    fr: 'Prêt, mais /data n’est pas encore lisible : la limite mensuelle ne compte que ce qui a été envoyé depuis le démarrage (relu toutes les 10 s).',
  },
  working: {
    en: 'Amazon Polly answered (voice {voice}, {engine} engine).',
    fr: 'Amazon Polly a répondu (voix {voice}, moteur {engine}).',
  },
  refused: {
    en: 'AWS refused these keys in this region (unknown, deleted or deactivated key, wrong secret, or a region not enabled on the account). Nothing is sent with them until the keys or the region change, or the Test button succeeds.',
    fr: 'AWS a refusé ces clés dans cette région (clé inconnue, supprimée ou désactivée, secret erroné, ou région non activée sur le compte). Plus rien n’est envoyé avec elles tant que les clés ou la région ne changent pas, ou que le bouton Tester ne réussit pas.',
  },
  denied: {
    en: 'AWS accepted the keys but denied the synthesis: give the IAM user the polly:SynthesizeSpeech permission.',
    fr: 'AWS a accepté les clés mais refusé la synthèse : donnez à l’utilisateur IAM le droit polly:SynthesizeSpeech.',
  },
  clock: {
    en: 'AWS rejected the request time: check the clock of the Gladys host. The next request uses the AWS time.',
    fr: 'AWS a rejeté l’heure de la requête : vérifiez l’horloge de la machine Gladys. La requête suivante utilise l’heure d’AWS.',
  },
  paused: {
    en: 'Amazon Polly asked to slow down or failed: no request before {time} (UTC).',
    fr: 'Amazon Polly a demandé de ralentir ou a échoué : aucune requête avant {time} (UTC).',
  },
  invalid: {
    en: 'Amazon Polly refused the request: {detail}',
    fr: 'Amazon Polly a refusé la requête : {detail}',
  },
  timeout: {
    en: 'Amazon Polly did not answer in time.',
    fr: 'Amazon Polly n’a pas répondu à temps.',
  },
  network: {
    en: 'Amazon Polly could not be reached, or the connection was cut (network).',
    fr: 'Amazon Polly est injoignable, ou la connexion a été coupée (réseau).',
  },
  bad_answer: {
    en: 'Amazon Polly sent an answer that is not an MP3 clip.',
    fr: 'Amazon Polly a envoyé une réponse qui n’est pas un clip MP3.',
  },
  too_large: {
    en: 'The clip is larger than the 5 MB Gladys accepts.',
    fr: 'Le clip dépasse les 5 Mo acceptés par Gladys.',
  },
  limit_reached: {
    en: 'The monthly limit of {limit} characters is reached ({used} sent this month, UTC): nothing more is sent before next month or a higher limit.',
    fr: 'La limite mensuelle de {limit} caractères est atteinte ({used} envoyés ce mois-ci, UTC) : plus rien n’est envoyé avant le mois prochain ou une limite plus haute.',
  },
  busy: {
    en: 'Too many announcements at once: this one was not sent.',
    fr: 'Trop d’annonces à la fois : celle-ci n’a pas été envoyée.',
  },
  empty_text: {
    en: 'Nothing to say: the text is empty.',
    fr: 'Rien à dire : le texte est vide.',
  },
  stopped: {
    en: 'The integration is stopping.',
    fr: 'L’intégration s’arrête.',
  },
  // The Test button.
  test_ok: {
    en: 'Amazon Polly answered: voice {voice}, {engine} engine, {size} KB of MP3 in {ms} ms. Nothing is played here: try a “Play a notification” scene action.',
    fr: 'Amazon Polly a répondu : voix {voice}, moteur {engine}, {size} Ko de MP3 en {ms} ms. Rien n’est joué ici : essayez l’action de scène « Jouer une notification ».',
  },
  test_sentence: {
    en: 'Hello, this is Amazon Polly speaking for Gladys.',
    fr: 'Bonjour, ici Amazon Polly qui parle pour Gladys.',
  },
  test_sentence_de: {
    en: 'Hallo, hier spricht Amazon Polly für Gladys.',
    fr: 'Hallo, hier spricht Amazon Polly für Gladys.',
  },
};

/** The text of `key` in `lang` ('fr' or English), placeholders filled. */
export function t(key, lang = 'en', vars = {}) {
  const entry = ALL_TEXTS[key] ?? ALL_TEXTS.network;
  const text = lang === 'fr' ? entry.fr : entry.en;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

/** Both languages, for setConnectionStatus and the action results. */
export function both(key, vars = {}) {
  return { en: t(key, 'en', vars), fr: t(key, 'fr', vars) };
}
