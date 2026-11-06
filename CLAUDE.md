# Chronicum

## Propriété intellectuelle Games Workshop

Chronicum est un outil de fan non officiel. GW protège sa marque de près et a déjà fait retirer des sites de fans qui reprenaient règles et fiches (Kill Team Battlekit, 2025). Ces règles passent avant toute demande de fonctionnalité.

**Autorisé**
- Les noms des missions, des dispositions de force et des factions, et leurs valeurs en points.
- Des libellés courts écrits avec nos mots, qui disent quand une carte score (30 mots au plus, vérifié par le garde-fou).
- Un lien vers gdmissions.app pour le texte complet des cartes.
- « pour Warhammer 40,000 » de façon descriptive, toujours avec la mention non officielle (clé `unofficial` dans `src/i18n.ts`, balise description de `index.html`, manifeste de `vite.config.ts`).

**Interdit**
- Le texte d'une carte, d'une règle, d'une fiche d'unité, d'un stratagème ou d'une aptitude, même traduit ou reformulé de près. Pas de caractéristiques d'unités ni de points d'unités.
- Les logos, illustrations, icônes de faction, polices et photos de figurines GW, l'aquila, la typographie « 40K ».
- « Warhammer », « 40K », « 40,000 » ou un nom de faction dans le nom de l'app, un domaine, une icône ou un titre de page.
- Le mot « officiel », ou toute formule qui laisse croire à un lien avec GW.
- Toute ressource chargée ou liée depuis un site GW (images, PDF, polices, pages).
- Coller du texte GW (cartes, règles, PDF) dans une session Claude : GW refuse que son contenu passe par une IA. Pour une nouvelle mission, Adrien donne lui-même le nom et les points, et on écrit le libellé.
- Toute monétisation (dons, pub, abonnement, affiliation) sans décision explicite d'Adrien.

**Quand une demande touche à ça** (un joueur veut les règles dans l'app, une nouvelle carte, une image) : proposer un libellé court et le lien gdmissions, jamais le texte. Dans le doute, demander à Adrien avant d'écrire.

**Garde-fou** : `scripts/ip-guard.mjs` tourne avant chaque build (`prebuild`) et après chaque fichier écrit par Claude (hook dans `.claude/settings.json`). S'il échoue, corriger le contenu. Ne jamais le contourner, relever `MAX_LABEL_WORDS` ou ajouter un fichier à `OWN_ASSETS` sans l'accord d'Adrien sur l'origine du fichier.

Les clés `warhammerClock.*` du localStorage et le projet Firebase `warhammerclock` restent tels quels : les joueurs ne les voient pas, et les renommer effacerait leurs réglages.
