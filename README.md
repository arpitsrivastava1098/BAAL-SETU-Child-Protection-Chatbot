# KAWACH Child Protection Chatbot — FINAL AI STARTER

This is a separate project. It does NOT modify the existing
`arpitsrivastava.co.in` website.

## What happens

Child -> KAWACH website -> `/api/chat` -> secure Node.js backend -> OpenAI Responses API
-> English answer -> Hindi answer.

The API key stays on the server. Do NOT put it in `index.html`.

## Test on your computer

1. Install Node.js 20+.
2. Extract this ZIP.
3. Open Command Prompt/Terminal in this project folder.
4. Run:
   npm install
5. Create a file named `.env` in the same folder.
6. Put:
   OPENAI_API_KEY=YOUR_REAL_API_KEY
   PORT=3000
7. Run:
   npm start
8. Open:
   http://localhost:3000

## GitHub

Create a NEW repository, for example:
KAWACH-Child-Protection-Chatbot

Upload the project files. Do NOT upload `.env`.

Important: GitHub Pages alone cannot run `server.js`. The backend needs a server-capable
hosting platform. The frontend and backend should be deployed together, or the frontend
must call the backend URL.

## Subdomain

After the backend is deployed, point:
kawach.arpitsrivastava.co.in
to the deployed app according to the hosting provider's custom-domain instructions.

Your existing:
arpitsrivastava.co.in
stays unchanged.

## Production checklist

- Keep API key in server environment variables.
- Add rate limiting before public launch.
- Add privacy-preserving logs/monitoring.
- Review the legal/child-protection knowledge with a qualified professional.
- Re-check official helpline/legal information periodically.
- Test emergency, abuse, child marriage, POCSO, trafficking and self-harm flows.
- Add a clear privacy notice and age-appropriate terms before launch.

## Current official baseline

The knowledge file contains the verified baseline used for the prototype:
1098 Child Helpline, 112 emergency, 1930 cybercrime helpline, JJ Act 2015,
POCSO Act 2012, Prohibition of Child Marriage Act 2006, Mission Vatsalya and
National Cyber Crime Reporting Portal.
