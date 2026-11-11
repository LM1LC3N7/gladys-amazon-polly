# Amazon Polly

Donne à Gladys les voix d’**Amazon Polly** pour ses annonces (l’action de scène « Jouer une notification ») et la
réponse de l’assistant vocal, avec **votre propre compte AWS**. Non officielle : sans lien avec Amazon.

Cette intégration n’a encore jamais été testée avec un vrai compte AWS : elle a été écrite d’après la
documentation d’Amazon Polly et testée contre une imitation locale de l’API Polly.

## Ce qu’elle fait

Gladys envoie un texte (2 000 caractères au plus) et la langue de l’utilisateur. L’intégration prend la voix
choisie pour cette langue (français, anglais ou allemand ; sinon celle de « Langue si inconnue »), demande un
clip MP3 à Amazon Polly et le remet à Gladys, qui le joue sur vos enceintes.

Ensuite, dans Gladys, ouvrez **Intégrations → Intelligence artificielle**, carte **Voix**, et choisissez
**Amazon Polly**.

Limites de Gladys elle-même (pas de l’intégration) : le clip est servi aux enceintes sur votre réseau local, et
la réponse de l’assistant vocal reste en texte dans une page HTTPS (voir la documentation de Gladys).

## Ce que cela coûte

Amazon Polly est facturé au caractère envoyé, sur votre compte AWS (tarifs sur
[aws.amazon.com/polly/pricing](https://aws.amazon.com/polly/pricing/), novembre 2026 : environ 4 USD le million de
caractères avec le moteur **standard**, environ 16 USD en **neuronal**, plus en génératif et long format ; les
nouveaux comptes ont un quota gratuit la première année). Le moteur standard est celui par défaut.

Pour garder la facture en main :

- **Limite mensuelle** (1 000 000 de caractères par défaut) : comptée en mémoire avant le départ de chaque
  requête, et écrite dans `/data` (l’écriture attendue 1 s au plus) ; atteinte, plus rien n’est envoyé avant le mois civil suivant (UTC) ou une limite plus
  haute. Une requête peut-être facturée (pas de réponse, connexion coupée) reste comptée ; une requête à
  laquelle AWS a répondu par une erreur ne l’est pas. Une annonce n’est jamais bloquée par `/data` (retardée de 3 s au plus) : s’il n’est
  pas encore lu (2 s au plus), en lecture seule ou lent, la requête part quand même et le statut dit « le compteur
  mensuel n’est pas enregistré : le plafond n’est garanti que jusqu’au prochain redémarrage » (la pause et un refus
  gardés dans `/data` peuvent aussi être inconnus). Une coupure de courant ou un plantage au mauvais moment peut
  faire perdre le décompte d’une requête.
- Le même texte dans la même voix est rejoué depuis la mémoire (24 heures, 20 clips), pas facturé deux fois ;
  demandé plusieurs fois à la fois (une scène qui annonce sur plusieurs enceintes), il ne fait qu’une requête
  dont tous partagent la réponse.
- 2 requêtes à la fois au plus et 8 en attente ; au-delà, au même moment, refus (« Trop d’annonces à la fois »).
- Pas de nouvel essai : une requête en échec n’est pas renvoyée par l’intégration (un nouvel essai pourrait
  être facturé deux fois).

## Créer la clé AWS (droits minimaux)

1. Dans la console AWS, **IAM → Utilisateurs → Créer un utilisateur** (sans accès à la console).
2. Attachez seulement cette stratégie (elle permet la synthèse, rien d’autre) :

```json
{
  "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow", "Action": "polly:SynthesizeSpeech", "Resource": "*" }]
}
```

3. **Informations d’identification de sécurité → Créer une clé d’accès** (« Application exécutée en dehors
   d’AWS »). Copiez l’identifiant de clé d’accès (`AKIA…`) et la clé d’accès secrète (affichée une seule fois).
4. Si vous le souhaitez, posez une alerte **AWS Budgets** sur votre compte : c’est la seule limite qu’AWS
   applique de son côté.

## Configuration

| Champ                                 | Rôle                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identifiant de clé d’accès            | L’identifiant `AKIA…` de l’utilisateur IAM.                                                                                                                               |
| Clé d’accès secrète                   | Gardée par Gladys dans sa base, jamais réaffichée, envoyée seulement à Amazon Web Services : elle signe chaque requête, seule la signature circule, pas la clé elle-même. |
| Région AWS                            | Où Polly tourne (`eu-west-1`, Irlande, par défaut). Tous les moteurs n’existent pas dans toutes les régions.                                                              |
| Moteur de voix                        | `standard` (par défaut, le moins cher), neuronal, génératif, long format.                                                                                                 |
| Voix française / anglaise / allemande | La voix de chaque langue. Les voix marquées « pas standard » exigent le moteur neuronal ou plus récent : Polly les refuse avec le moteur standard, et l’erreur le dit.    |
| Langue si inconnue                    | La voix utilisée quand Gladys n’envoie pas de langue, ou une autre.                                                                                                       |
| Débit de parole                       | De très lent à très rapide (SSML `prosody` ; les balises ne sont pas facturées).                                                                                          |
| Limite mensuelle (caractères)         | De 1 000 à 100 000 000 ; 1 000 000 par défaut.                                                                                                                            |

Le bouton **Tester la voix** demande à Polly une courte phrase (environ 50 caractères facturés) avec les réglages
enregistrés et dit combien de temps cela a pris. Rien n’est joué.

## Quand quelque chose ne va pas

Le statut de l’écran Configuration dit pourquoi :

- **AWS a refusé ces clés** (clé inconnue, supprimée ou désactivée, secret erroné, ou région non activée sur le
  compte, comme eu-south-2 ou af-south-1) : plus rien n’est envoyé avec elles dans cette région, même après un redémarrage (dès que `/data` est lu), tant que vous ne saisissez pas d’autres clés, ne choisissez pas une autre région, ou que le bouton
  **Tester** ne réussit pas (il envoie quand même). `/data` ne garde que 8 bits d’une empreinte salée des clés
  refusées, jamais les clés : après un redémarrage, d’autres clés ont 1 chance sur 256 de paraître refusées ; le
  bouton Tester lève alors le refus.
- **Refusé** (`AccessDeniedException`) : les clés sont valides mais l’utilisateur IAM n’a pas
  `polly:SynthesizeSpeech`. Ce n’est pas un refus des clés : l’annonce suivante réessaie.
- **Horloge** : AWS a rejeté l’heure de la requête ; vérifiez l’horloge de la machine Gladys.
- **Ralentir / échec de Polly** (limitation, HTTP 429 ou 5xx) : aucune requête pendant 60 s, puis 2, 4… minutes
  jusqu’à 1 heure si cela continue (plus quand AWS le demande par `Retry-After`, 6 heures au plus) ; le bouton
  Tester attend aussi. La pause est gardée dans `/data` au redémarrage ; un succès y met fin.
- **Polly a refusé la requête** : sa raison est affichée (par exemple « This voice does not support the selected
  engine »), coupée avant la première valeur qu’elle cite (votre texte pourrait en être une, même en partie) ; rien n’est facturé.
- **Injoignable, ou connexion coupée** : une coupure après le départ de la requête reste comptée.
- **Pas de réponse à temps** : Gladys attend 30 s ; l’intégration abandonne à 25 s.

## Vie privée

Le texte à dire est envoyé à Amazon Web Services, dans la région choisie. L’intégration ne l’écrit jamais dans
les journaux ni dans `/data` (seulement sa longueur) ; les clips restent en mémoire seulement.
