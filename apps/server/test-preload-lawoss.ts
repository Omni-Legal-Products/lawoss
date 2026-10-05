// LAWOSS: upstream testy overujú firemnú synchronizáciu Eigenwelt, ktorú LAWOSS
// predvolene vypína (src/lawoss/commercial-services.ts). Tu ju pre testy zapneme.
process.env.LAWOSS_EIGENWELT_FIRM_SERVICES = "1";
// Rovnako účet Eigenwelt a jeho platené modely (src/lawoss/commercial-services.ts).
process.env.LAWOSS_EIGENWELT_ACCOUNT = "1";
