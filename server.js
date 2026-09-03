import express from "express";
import dotenv from "dotenv";
import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri
} from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import pdfParse from "pdf-parse";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================================================
   CONFIGURATION
========================================================= */

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    })
  : null;

/*
  PDFs are NOT downloaded during server startup.
  They are loaded only when required.
*/

const PDF_URLS = [
  "https://arpitsrivastava.co.in/resources/Kawach%20Madule.pdf",
  "https://arpitsrivastava.co.in/resources/Meena%20munch%20module.pdf",
  "https://arpitsrivastava.co.in/resources/CWPC%20Strengthening%20and%20Activation%20Process%20Document.pdf",
  "https://arpitsrivastava.co.in/resources/Bal%20sanrakshan%2010-03-2026%20(1).pdf",
  "https://arpitsrivastava.co.in/resources/SHG%20Module.pdf",
  "https://arpitsrivastava.co.in/resources/Yojana%20Module%2004-26.pdf",
  "https://arpitsrivastava.co.in/resources/Child-Trafficking-Resource.pdf"
];

const KNOWLEDGE_FILE = path.join(
  __dirname,
  "knowledge.txt"
);

const pdfFiles = PDF_URLS.map((url) => ({
  name: decodeURIComponent(
    url.split("/").pop()
  ),
  url,
  loaded: false,
  loading: null,
  uploadedFile: null
}));

let documents = [];
let chunks = [];
let knowledgeReady = false;

/* =========================================================
   ADDITIONAL CHILD SAFETY KNOWLEDGE BASE — 100 Q&A
   Existing knowledge/resources are unchanged.
========================================================= */

const CHILD_SAFETY_100_QA = `
Q1. Good Touch और Bad Touch क्या है?
A. Good touch वह स्पर्श है जिसमें बच्चा सुरक्षित और सहज महसूस करे। ऐसा स्पर्श जो डराए, चोट पहुँचाए, असहज करे या निजी अंगों से जुड़ा हो, unsafe हो सकता है। असहज लगे तो दूर हटें और किसी भरोसेमंद बड़े को बताएं।

Q2. अगर कोई मुझे गलत तरीके से छुए तो क्या करूँ?
A. तुरंत सुरक्षित जगह जाएं, स्पष्ट रूप से NO कहें यदि सुरक्षित हो, और किसी भरोसेमंद बड़े को बताएं। खतरा तत्काल हो तो 112 या Child Helpline 1098 से मदद लें।

Q3. अगर कोई मुझे धमकी दे तो क्या करूँ?
A. अकेले सामना न करें। सुरक्षित जगह जाएं, धमकी के संदेश/सबूत सुरक्षित रखें और भरोसेमंद बड़े को बताएं। तत्काल खतरे में 112 से संपर्क करें।

Q4. अगर कोई मुझे कोई बात secret रखने को कहे तो?
A. ऐसा secret जो आपको डराए या असहज करे, भरोसेमंद बड़े से बताना जरूरी है। आपकी सुरक्षा किसी secret से ज्यादा महत्वपूर्ण है।

Q5. Trusted adult कौन हो सकता है?
A. माता-पिता, शिक्षक, रिश्तेदार, स्कूल counsellor, आंगनवाड़ी/फ्रंटलाइन कार्यकर्ता या कोई ऐसा जिम्मेदार वयस्क जिस पर आप भरोसा करते हों।

Q6. अगर मुझे घर में डर लगता है तो?
A. किसी सुरक्षित और भरोसेमंद वयस्क को बताएं। यदि तत्काल खतरा है तो सुरक्षित स्थान पर जाएं और 112 या 1098 से सहायता लें।

Q7. अगर कोई बड़ा व्यक्ति मुझे अकेले मिलने बुलाए तो?
A. अकेले न जाएं। अपने भरोसेमंद बड़े को बताएं और सार्वजनिक/सुरक्षित जगह में रहें।

Q8. क्या गलत व्यवहार होने पर मेरी गलती है?
A. नहीं। किसी दूसरे व्यक्ति का गलत व्यवहार बच्चे की गलती नहीं है। मदद मांगना सही कदम है।

Q9. कोई private photo मांग रहा है तो?
A. न भेजें। बातचीत का प्रमाण सुरक्षित रखें, व्यक्ति को block/report करें और किसी भरोसेमंद बड़े को बताएं।

Q10. कोई photo viral करने की धमकी दे तो?
A. पैसे या दूसरी मांग पूरी करने के दबाव में न आएं। सबूत सुरक्षित रखें, account report/block करें और भरोसेमंद बड़े से मदद लें। तत्काल खतरे में 112।

Q11. Online bullying क्या है?
A. Internet या digital platforms पर किसी को बार-बार परेशान करना, अपमानित करना, धमकाना या शर्मिंदा करना online bullying/cyberbullying हो सकता है।

Q12. Online कोई परेशान करे तो?
A. जवाब देकर विवाद बढ़ाने के बजाय block/report करें, evidence रखें और trusted adult को बताएं। गंभीर या अपराध संबंधी स्थिति में cybercrime reporting की सहायता लें।

Q13. Cyber crime की शिकायत कैसे करें?
A. भारत में cybercrime की शिकायत के लिए National Cyber Crime Reporting Portal और जरूरत के अनुसार 1930 cyber helpline की सहायता ली जा सकती है।

Q14. मेरा social media account hack हो जाए तो?
A. पासवर्ड बदलें, सभी अनजान sessions से logout करें, two-factor authentication चालू करें और platform पर account recovery/report विकल्प इस्तेमाल करें।

Q15. Strong password कैसे बनाएं?
A. लंबा और अलग password रखें, अलग-अलग accounts में एक ही password न रखें और OTP/password किसी से साझा न करें।

Q16. Online game में कोई personal information मांगे तो?
A. नाम, पता, school, phone number, password या अन्य निजी जानकारी साझा न करें। भरोसेमंद बड़े को बताएं।

Q17. Online दोस्त से अकेले मिलने जाना सुरक्षित है?
A. नहीं। Online पहचान हमेशा वास्तविक पहचान की गारंटी नहीं देती। मिलने की जरूरत हो तो trusted adult की जानकारी और मौजूदगी के बिना न जाएं।

Q18. Fake social media account की शिकायत कैसे करें?
A. Platform के report विकल्प का उपयोग करें, screenshots/evidence रखें और भरोसेमंद बड़े को बताएं। यदि धोखाधड़ी या अपराध हो तो cybercrime reporting की मदद लें।

Q19. POCSO Act क्या है?
A. POCSO Act बच्चों को sexual assault, sexual harassment और pornography से सुरक्षा देने वाला भारतीय कानून है।

Q20. Sexual abuse क्या है?
A. बच्चे के साथ sexual nature का ऐसा व्यवहार जो उसकी सुरक्षा और गरिमा को नुकसान पहुंचाए, sexual abuse हो सकता है। ऐसे मामले में बच्चे को तुरंत सुरक्षित सहायता मिलनी चाहिए।

Q21. अगर मेरे साथ sexual abuse हुआ है तो क्या यह मेरी गलती है?
A. नहीं। यह बच्चे की गलती नहीं है। सुरक्षित जगह जाएं और भरोसेमंद वयस्क तथा जरूरत के अनुसार 1098/112 से सहायता लें।

Q22. अगर आरोपी मेरा रिश्तेदार हो तो?
A. रिश्ता होने से गलत व्यवहार सही नहीं हो जाता। सुरक्षित वयस्क को बताएं और जरूरत पड़ने पर 1098/112 से सहायता लें।

Q23. POCSO की शिकायत कौन कर सकता है?
A. बच्चा स्वयं या उसकी ओर से कोई व्यक्ति संबंधित authorities को सूचना दे सकता है। ऐसे मामले में trusted adult और Child Helpline 1098 से मार्गदर्शन लिया जा सकता है।

Q24. क्या बच्चे की बात सुनी जाएगी?
A. बाल संरक्षण व्यवस्था का उद्देश्य बच्चे की सुरक्षा, गरिमा और best interests को ध्यान में रखकर उसकी बात सुनना है।

Q25. अगर मुझे किसी ने गलत तरीके से touch किया हो तो किसे बताऊँ?
A. माता-पिता, शिक्षक, counsellor या किसी भरोसेमंद वयस्क को बताएं। यदि सुरक्षित व्यक्ति उपलब्ध न हो तो 1098 से सहायता लें।

Q26. बाल विवाह क्या है?
A. जब कानून में निर्धारित न्यूनतम विवाह आयु से कम उम्र में विवाह किया जाता है, उसे बाल विवाह कहा जाता है।

Q27. मेरी शादी कम उम्र में कराई जा रही है तो?
A. किसी भरोसेमंद वयस्क, शिक्षक या स्थानीय child protection authority को तुरंत बताएं। तत्काल खतरे में 112 और सहायता के लिए 1098 से संपर्क करें।

Q28. मेरे दोस्त की शादी होने वाली है तो?
A. उसे अकेला न छोड़ें। किसी भरोसेमंद वयस्क, शिक्षक या संबंधित child protection authority को सूचना दें और जरूरत पर 1098/112 से सहायता लें।

Q29. बाल विवाह की शिकायत कहाँ करें?
A. स्थानीय child protection authorities/पुलिस या Child Helpline 1098 से सहायता ली जा सकती है। तत्काल खतरे में 112।

Q30. बाल विवाह से क्या नुकसान हो सकता है?
A. यह बच्चे की शिक्षा, स्वास्थ्य, सुरक्षा और विकास पर गंभीर असर डाल सकता है तथा कानून का उल्लंघन हो सकता है।

Q31. बाल श्रम क्या है?
A. बच्चों से ऐसा काम करवाना जो कानून द्वारा प्रतिबंधित हो या उनकी शिक्षा, सुरक्षा, स्वास्थ्य और विकास को नुकसान पहुंचाए, child labour के दायरे में आ सकता है।

Q32. मुझसे दुकान या होटल में काम कराया जा रहा है तो?
A. किसी भरोसेमंद वयस्क, शिक्षक या संबंधित अधिकारी को बताएं। यदि आप खतरे में हैं तो सुरक्षित जगह जाएं और 1098/112 से मदद लें।

Q33. परिवार की आर्थिक मजबूरी में बच्चा काम कर रहा हो तो?
A. बच्चे की शिक्षा और सुरक्षा को प्राथमिकता दें तथा परिवार को उपलब्ध सरकारी/social protection सहायता और child protection services से जोड़ने का प्रयास करें।

Q34. बाल श्रम की शिकायत कैसे करें?
A. Child Helpline 1098 या स्थानीय संबंधित child protection/labour authorities से सहायता ली जा सकती है।

Q35. Teacher मुझे मारते हैं तो क्या करूँ?
A. किसी भरोसेमंद शिक्षक, प्रधानाचार्य, माता-पिता या अन्य responsible adult को बताएं। यदि गंभीर या तत्काल खतरा हो तो 112 से सहायता लें।

Q36. School में bullying हो तो?
A. अकेले बदला लेने की कोशिश न करें। trusted teacher, parent या school authority को बताएं और evidence हो तो सुरक्षित रखें।

Q37. School में sexual harassment हो तो?
A. तुरंत trusted adult, school authority या संबंधित child protection support को बताएं। तत्काल खतरे में 112 और child support के लिए 1098।

Q38. अगर कोई senior मुझे परेशान करे तो?
A. अकेले सामना न करें। trusted teacher/parent को बताएं और सुरक्षित स्थान पर रहें।

Q39. School में Child Protection Committee क्या करती है?
A. ऐसी व्यवस्थाएं बच्चों की सुरक्षा, जोखिम की पहचान, शिकायत/सहायता और सुरक्षित वातावरण को मजबूत करने में मदद करती हैं।

Q40. मुझे school छोड़ने के लिए मजबूर किया जा रहा है तो?
A. किसी trusted adult या शिक्षक से बात करें और शिक्षा जारी रखने के लिए उपलब्ध सहायता के बारे में जानकारी लें।

Q41. घर में मेरे साथ मारपीट होती है तो?
A. पहले सुरक्षित स्थान पर जाएं और किसी भरोसेमंद वयस्क को बताएं। तत्काल खतरे में 112 और child protection सहायता के लिए 1098।

Q42. माता-पिता मुझे घर से निकालने की धमकी दें तो?
A. अकेले घर से निकलने के बजाय किसी भरोसेमंद वयस्क, शिक्षक या child protection service से सहायता लें। तत्काल खतरे में 112।

Q43. मुझे जबरदस्ती कहीं भेजा जा रहा है तो?
A. यदि संभव हो तो भरोसेमंद वयस्क को तुरंत बताएं। जबरदस्ती या तत्काल खतरे में 112 से सहायता लें।

Q44. अगर मैं घर से खो गया/गई हूँ तो?
A. किसी पुलिस अधिकारी, भरोसेमंद वयस्क या Child Helpline 1098 से तुरंत मदद लें। किसी अनजान व्यक्ति के साथ न जाएं।

Q45. अगर मेरा दोस्त missing है तो?
A. तुरंत उसके परिवार/भरोसेमंद वयस्क और संबंधित authorities को बताएं। जरूरत पर 1098 या 112 से सहायता लें।

Q46. रेलवे स्टेशन पर अकेला बच्चा मिले तो?
A. बच्चे को सुरक्षित रखें और रेलवे/police/Child Helpline 1098 जैसी child protection सहायता से संपर्क करें।

Q47. Missing child मिलने पर क्या करें?
A. बच्चे को सुरक्षित रखें, उसकी पहचान या निजी जानकारी सार्वजनिक न करें और संबंधित authorities/Child Helpline 1098 को सूचना दें।

Q48. Human trafficking क्या है?
A. किसी व्यक्ति को शोषण के उद्देश्य से भर्ती, ले जाना, छिपाना या नियंत्रित करना trafficking का हिस्सा हो सकता है। बच्चे को ऐसी स्थिति से तुरंत protection चाहिए।

Q49. कोई नौकरी का लालच देकर बाहर ले जाना चाहता है तो?
A. अकेले न जाएं। प्रस्ताव और व्यक्ति की जानकारी trusted adult को बताएं और सुरक्षित सत्यापन के बिना यात्रा न करें।

Q50. कोई मुझे जबरदस्ती कहीं ले जा रहा है तो?
A. जहाँ सुरक्षित हो मदद के लिए आवाज दें, सुरक्षित जगह जाएं और 112 से तत्काल सहायता लें। Child Helpline 1098 से भी मदद ली जा सकती है।

Q51. अगर कोई बच्चा trafficking का शिकार हो सकता है तो?
A. बच्चे को दोष न दें। उसकी सुरक्षा सुनिश्चित करें और 1098/112 या संबंधित authorities को सूचना दें।

Q52. नशा बच्चों के लिए क्यों खतरनाक है?
A. नशे की चीजें स्वास्थ्य, मस्तिष्क, पढ़ाई, संबंधों और सुरक्षा पर गंभीर असर डाल सकती हैं। किसी भरोसेमंद वयस्क से मदद लेना बेहतर है।

Q53. कोई मुझे cigarette/vape दे तो?
A. इसे न लें। वहाँ से सुरक्षित हटें और trusted adult को बताएं।

Q54. मेरा दोस्त नशा करता है तो मैं क्या करूँ?
A. उसे शर्मिंदा न करें। किसी trusted adult, parent, teacher या उचित support service से मदद लेने के लिए प्रेरित करें।

Q55. कोई मुझे नशा करने के लिए मजबूर करे तो?
A. उस व्यक्ति से दूर जाएं और trusted adult को बताएं। तत्काल खतरे में 112 से सहायता लें।

Q56. मेरे क्या child rights हैं?
A. बच्चों को सुरक्षा, शिक्षा, विकास, सम्मान और अपनी बात रखने सहित कई अधिकार प्राप्त हैं।

Q57. क्या हर बच्चे को शिक्षा का अधिकार है?
A. भारत में बच्चों की शिक्षा से जुड़े कानूनी अधिकार हैं। स्कूल से संबंधित समस्या होने पर trusted teacher/authority से सहायता लें।

Q58. School में admission नहीं मिल रहा तो?
A. माता-पिता/guardian, school authority और स्थानीय शिक्षा विभाग से सहायता लें। बच्चे को स्कूल से बाहर रखने की समस्या में संबंधित child/education support से मार्गदर्शन लिया जा सकता है।

Q59. मुझे school में discrimination का सामना करना पड़ता है तो?
A. किसी भरोसेमंद शिक्षक, प्रधानाचार्य, माता-पिता या school grievance mechanism को बताएं।

Q60. अगर मुझे बहुत डर लग रहा है तो?
A. किसी भरोसेमंद व्यक्ति के पास जाएं और अपनी बात बताएं। यदि आप तत्काल खतरे में हैं तो 112 से मदद लें।

Q61. मैं बहुत परेशान हूँ, किससे बात करूँ?
A. किसी trusted adult, शिक्षक, parent या counsellor से बात करें। यदि आपकी सुरक्षा को तत्काल खतरा है तो 112 या 1098 से मदद लें।

Q62. अगर मुझे लगता है कि कोई मेरी बात नहीं समझता तो?
A. ऐसे व्यक्ति को खोजें जो ध्यान से सुने—जैसे trusted teacher, parent, counsellor या अन्य responsible adult। मदद मांगते रहना ठीक है।

Q63. अगर मुझे खुद को नुकसान पहुंचाने का मन हो तो?
A. अकेले न रहें। तुरंत किसी भरोसेमंद वयस्क को बताएं और सुरक्षित स्थान पर जाएं। तत्काल खतरे में 112 से emergency help लें। किसी भी self-harm method का प्रयोग न करें।

Q64. अगर कोई मुझे online blackmail करे तो?
A. पैसे या धमकी की मांग पूरी करने के दबाव में न आएं। evidence सुरक्षित रखें, account/report tools का उपयोग करें और trusted adult को बताएं। Cybercrime reporting की सहायता लें।

Q65. अगर कोई मेरी video record कर ले तो?
A. यदि बिना अनुमति रिकॉर्ड किया गया है या आपको डराया जा रहा है, trusted adult को बताएं, evidence सुरक्षित रखें और जरूरत पर platform/reporting या authorities से सहायता लें।

Q66. अगर मेरी private information online फैल जाए तो?
A. घबराएं नहीं। Screenshots/evidence सुरक्षित रखें, platform पर report करें, trusted adult को बताएं और गंभीर cybercrime में reporting सहायता लें।

Q67. Online privacy क्या है?
A. अपनी निजी जानकारी, फोटो, location, password और account details को अनजान लोगों से सुरक्षित रखना online privacy का हिस्सा है।

Q68. Location online share करनी चाहिए?
A. अनजान लोगों या public posts में अपना live location या exact address साझा न करें।

Q69. क्या strangers को अपना phone number देना चाहिए?
A. नहीं, जब तक किसी भरोसेमंद वयस्क की जानकारी और उचित कारण न हो।

Q70. अगर कोई online कहे कि वह police है तो?
A. सिर्फ online दावा देखकर भरोसा न करें। कोई OTP, password या पैसे न दें और trusted adult को बताएं।

Q71. अगर कोई online पैसे मांगता है तो?
A. पैसे न भेजें और bank/UPI/OTP details साझा न करें। trusted adult को बताएं।

Q72. अगर मेरा दोस्त online किसी गलत व्यक्ति से बात कर रहा है तो?
A. उसे बिना शर्मिंदा किए सावधान करें और किसी trusted adult को बताएं, खासकर यदि वह व्यक्ति धमका रहा हो या निजी फोटो मांग रहा हो।

Q73. अगर मुझे कोई inappropriate message भेजे तो?
A. Reply न करना भी ठीक है। Screenshot/evidence रखें, sender को block/report करें और trusted adult को बताएं।

Q74. Child Helpline 1098 क्या है?
A. 1098 बच्चों के लिए सहायता और child protection support का official helpline number है। जरूरत पड़ने पर बच्चे या उसकी ओर से मदद मांगने वाला व्यक्ति संपर्क कर सकता है।

Q75. 112 क्या है?
A. 112 भारत का integrated emergency response number है। तत्काल खतरे या emergency में इसका उपयोग किया जा सकता है।

Q76. 1098 और 112 में क्या अंतर है?
A. 1098 बच्चों से संबंधित सहायता और child protection support के लिए है; 112 तत्काल emergency response के लिए है। परिस्थिति के अनुसार दोनों में सहायता ली जा सकती है।

Q77. Cyber Crime Helpline 1930 क्या है?
A. 1930 भारत में cyber financial fraud/cybercrime reporting support के लिए उपयोग किया जाने वाला helpline number है।

Q78. अगर पैसे की online ठगी हो जाए तो?
A. तुरंत अपने bank/payment provider को सूचित करें और cybercrime reporting के लिए 1930 तथा official cybercrime portal की सहायता लें।

Q79. क्या chatbot पर अपना password बताना चाहिए?
A. नहीं। BAAL-SETU या किसी व्यक्ति के साथ password, OTP, PIN, Aadhaar number या bank details साझा न करें।

Q80. क्या chatbot को अपना exact address बताना चाहिए?
A. नहीं। सुरक्षा के लिए exact home address या अन्य अनावश्यक पहचान संबंधी जानकारी साझा न करें।

Q81. अगर मुझे किसी trusted adult पर भी भरोसा नहीं है तो?
A. दूसरे सुरक्षित वयस्क की तलाश करें—जैसे शिक्षक, counsellor, रिश्तेदार या child protection support। जरूरत पर 1098/112 से मदद लें।

Q82. अगर कोई कहे कि मदद मांगना मेरी गलती है तो?
A. मदद मांगना गलत नहीं है। आपकी सुरक्षा सबसे महत्वपूर्ण है। किसी भरोसेमंद व्यक्ति या child helpline से संपर्क करें।

Q83. अगर मैं डर के कारण बोल नहीं पा रहा/रही हूँ तो?
A. आप message लिखकर, किसी trusted adult को संकेत देकर या किसी सुरक्षित व्यक्ति के पास जाकर मदद मांग सकते हैं। तत्काल खतरे में 112।

Q84. अगर मेरा भाई/बहन abuse का सामना कर रहा है तो?
A. उसे दोष न दें। उसकी सुरक्षा को प्राथमिकता दें और किसी trusted adult, 1098 या जरूरत पर 112 को बताएं।

Q85. अगर मुझे किसी बच्चे के abuse का पता चले तो?
A. बच्चे को दोष या शर्मिंदा न करें। किसी जिम्मेदार वयस्क/संबंधित authority को सूचना दें और जरूरत पर 1098/112 से सहायता लें।

Q86. क्या मुझे abuse की बात सबको बतानी चाहिए?
A. नहीं, सार्वजनिक रूप से जानकारी फैलाने के बजाय केवल सुरक्षित और जिम्मेदार लोगों/authorities को बताएं। बच्चे की privacy और dignity का ध्यान रखें।

Q87. अगर मुझे किसी ने unsafe काम करने को कहा तो?
A. साफ मना करें यदि सुरक्षित हो, वहाँ से हटें और trusted adult को बताएं। खतरे में 112 से मदद लें।

Q88. अगर कोई मुझे काम के बदले बहुत पैसे देने का वादा करे तो?
A. अकेले निर्णय न लें। trusted adult से बात करें और व्यक्ति/काम की सत्यता और सुरक्षा की जांच कराएं।

Q89. अगर मुझे रात में अकेले बाहर जाना पड़े तो?
A. जहाँ संभव हो trusted adult के साथ रहें और सुरक्षित, परिचित रास्ता चुनें। जोखिम लगे तो सहायता लें।

Q90. अगर कोई बच्चा सड़क पर अकेला मिले तो?
A. बच्चे की सुरक्षा को प्राथमिकता दें और 1098/police/स्थानीय child protection support से संपर्क करें।

Q91. अगर कोई बच्चा भीख मांग रहा हो तो?
A. बच्चे को दोष या अपमानित न करें। child protection authorities/1098 को सूचना देकर सहायता दिलाने की कोशिश करें।

Q92. अगर कोई बच्चा घर से भागना चाहता है तो?
A. उसे अकेले भागने के बजाय किसी भरोसेमंद वयस्क या child protection support से बात करने के लिए प्रेरित करें। तत्काल खतरे में 112/1098।

Q93. अगर घर में मेरी शादी की बात चल रही है तो?
A. यदि आपकी उम्र कानून में निर्धारित न्यूनतम आयु से कम है या आपको मजबूर किया जा रहा है, तो trusted adult/authority को तुरंत बताएं और 1098/112 से सहायता लें।

Q94. क्या बच्चे को अपनी समस्या बताने का अधिकार है?
A. हाँ, child protection में बच्चे की बात और उसके best interests को महत्व देना जरूरी है।

Q95. क्या मुझे मदद मांगने पर शर्मिंदा होना चाहिए?
A. नहीं। मदद मांगना बहादुरी और self-protection का कदम है।

Q96. अगर कोई मेरी शिकायत वापस लेने को कहे तो?
A. दबाव में निर्णय न लें। किसी trusted adult या संबंधित authority से सुरक्षित सलाह लें, खासकर यदि खतरा या abuse शामिल है।

Q97. अगर कोई मुझे पैसे देकर चुप रहने को कहे तो?
A. पैसे लेकर चुप रहना जरूरी नहीं है। trusted adult/authority को बताएं और अपनी सुरक्षा को प्राथमिकता दें।

Q98. अगर मुझे लगे कि कोई मेरा पीछा कर रहा है तो?
A. अकेली सुनसान जगह पर न जाएं। भीड़ या सुरक्षित स्थान में जाएं, trusted adult को फोन करें और तत्काल खतरे में 112 से संपर्क करें।

Q99. अगर कोई मुझे जबरदस्ती phone छीनने की कोशिश करे तो?
A. यदि physical harm का खतरा हो तो device बचाने से पहले अपनी सुरक्षा को प्राथमिकता दें। सुरक्षित जगह जाएं और जरूरत पर 112 से मदद लें।

Q100. बच्चों के लिए सबसे जरूरी safety rule क्या है?
A. अगर कोई चीज आपको डराए, चोट पहुंचाए या असहज करे—दूर हटें, सुरक्षित व्यक्ति को बताएं और जरूरत पड़ने पर 1098/112 से मदद लें।
`;

/* =========================================================
   FALLBACK RESPONSE
========================================================= */

const FALLBACK_RESPONSE = `English:
I’m sorry, I don’t have enough reliable information to answer this question. Please ask a question related to child protection. Contact 1098/112 if you need immediate help.

Hindi:
क्षमा करें, इस सवाल का विश्वसनीय जवाब मेरे पास उपलब्ध नहीं है। कृपया बाल संरक्षण से संबंधित सवाल पूछें। तत्काल सहायता के लिए 1098 या 112 पर संपर्क करें.`;

/* =========================================================
   TEXT UTILITIES
========================================================= */

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function makeChunks(
  text,
  size = 1500,
  overlap = 200
) {
  const clean = normalizeText(text);

  if (!clean) return [];

  const result = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(
      start + size,
      clean.length
    );

    if (end < clean.length) {
      const boundary = Math.max(
        clean.lastIndexOf("\n\n", end),
        clean.lastIndexOf(". ", end),
        clean.lastIndexOf(" ", end)
      );

      if (
        boundary >
        start + Math.floor(size * 0.6)
      ) {
        end = boundary + 1;
      }
    }

    const piece = clean
      .slice(start, end)
      .trim();

    if (piece) result.push(piece);

    if (end >= clean.length) break;

    start = Math.max(
      end - overlap,
      start + 1
    );
  }

  return result;
}

/* =========================================================
   SMART CHILD-SAFETY TOPIC DETECTION
   Helps Hindi, Hinglish and English variations find the
   right part of the built-in 100-question knowledge base.
========================================================= */

const TOPIC_PATTERNS = [
  {
    name: "touch",
    patterns: [
      /good\s*touch/i,
      /bad\s*touch/i,
      /wrong\s*touch/i,
      /गलत\s*(तरीके से)?\s*छू/i,
      /गलत\s*स्पर्श/i,
      /छूने/i,
      /छूता/i
    ]
  },
  {
    name: "child-marriage",
    patterns: [
      /child\s*marriage/i,
      /बाल\s*विवाह/i,
      /कम\s*उम्र.*शादी/i,
      /नाबालिग.*शादी/i,
      /जबरदस्ती.*शादी/i,
      /शादी\s*करवा/i
    ]
  },
  {
    name: "child-labour",
    patterns: [
      /child\s*labou?r/i,
      /बाल\s*(श्रम|मजदूरी)/i,
      /बच्चा.*काम/i,
      /बच्चे.*काम.*कर/i,
      /काम.*करव/i
    ]
  },
  {
    name: "pocso",
    patterns: [
      /pocso/i,
      /पॉक्सो/i,
      /sexual\s*abuse/i,
      /यौन\s*शोषण/i,
      /sexually/i
    ]
  },
  {
    name: "cyberbullying",
    patterns: [
      /cyber\s*bully/i,
      /online\s*(harassment|bullying|abuse)/i,
      /ऑनलाइन.*(परेशान|धमक|बुली)/i,
      /इंस्टाग्राम|instagram/i,
      /व्हाट्स?एप|whatsapp/i
    ]
  },
  {
    name: "password-otp",
    patterns: [
      /password/i,
      /पासवर्ड/i,
      /otp/i,
      /ओटीपी/i
    ]
  },
  {
    name: "child-helpline",
    patterns: [
      /1098/i,
      /child\s*helpline/i,
      /चाइल्ड\s*हेल्पलाइन/i
    ]
  },
  {
    name: "emergency",
    patterns: [
      /(^|\D)112(\D|$)/i,
      /emergency/i,
      /आपातकाल/i,
      /तत्काल\s*खतरा/i
    ]
  },
  {
    name: "cyber-fraud",
    patterns: [
      /1930/i,
      /cyber\s*fraud/i,
      /financial\s*fraud/i,
      /साइबर\s*फ्रॉड/i,
      /साइबर\s*ठगी/i
    ]
  },
  {
    name: "trafficking",
    patterns: [
      /traffick/i,
      /बाल\s*तस्करी/i,
      /तस्करी/i,
      /बेचने/i,
      /जबरदस्ती.*ले.*जाने/i
    ]
  },
  {
    name: "missing-child",
    patterns: [
      /missing\s*child/i,
      /missing/i,
      /लापता/i,
      /गुम\s*(बच्चा|हो)/i,
      /अकेला\s*बच्चा/i
    ]
  },
  {
    name: "self-harm",
    patterns: [
      /self[-\s]*harm/i,
      /suicide/i,
      /मरना\s*चाहता/i,
      /मरना\s*चाहती/i,
      /जान\s*देना/i,
      /खुद\s*को\s*नुकसान/i
    ]
  },
  {
    name: "online-safety",
    patterns: [
      /online/i,
      /इंटरनेट/i,
      /सोशल\s*मीडिया/i,
      /social\s*media/i,
      /private\s*photo/i,
      /निजी\s*फोटो/i
    ]
  },
  {
    name: "violence-home",
    patterns: [
      /violence/i,
      /घर.*मार/i,
      /मारपीट/i,
      /घरेलू\s*हिंसा/i,
      /घर.*डर/i,
      /unsafe.*home/i
    ]
  },
  {
    name: "school-safety",
    patterns: [
      /school/i,
      /स्कूल/i,
      /teacher/i,
      /शिक्षक/i,
      /bullying/i,
      /छात्र.*परेशान/i
    ]
  },
  {
    name: "child-rights",
    patterns: [
      /child\s*rights/i,
      /बाल\s*अधिकार/i,
      /शिक्षा.*अधिकार/i,
      /right\s*to\s*education/i
    ]
  },
  {
    name: "trusted-adult",
    patterns: [
      /trusted\s*adult/i,
      /भरोसेमंद\s*(बड़े|वयस्क|व्यक्ति)/i,
      /किससे\s*मदद/i,
      /help\s*me/i
    ]
  }
];

function detectTopics(question) {
  const text = normalizeText(question);

  return TOPIC_PATTERNS
    .filter(topic =>
      topic.patterns.some(
        pattern => pattern.test(text)
      )
    )
    .map(topic => topic.name);
}

function topicTerms(topic) {
  const map = {
    touch: [
      "touch",
      "स्पर्श",
      "छू",
      "private parts",
      "असहज"
    ],

    "child-marriage": [
      "child marriage",
      "बाल विवाह",
      "शादी",
      "नाबालिग",
      "कम उम्र"
    ],

    "child-labour": [
      "child labour",
      "child labor",
      "बाल श्रम",
      "बाल मजदूरी",
      "काम"
    ],

    pocso: [
      "pocso",
      "पॉक्सो",
      "sexual abuse",
      "यौन शोषण"
    ],

    cyberbullying: [
      "cyber",
      "online",
      "bullying",
      "instagram",
      "whatsapp",
      "ऑनलाइन",
      "परेशान"
    ],

    "password-otp": [
      "password",
      "पासवर्ड",
      "otp",
      "ओटीपी"
    ],

    "child-helpline": [
      "1098",
      "child helpline",
      "चाइल्ड हेल्पलाइन"
    ],

    emergency: [
      "112",
      "emergency",
      "आपातकाल",
      "तत्काल"
    ],

    "cyber-fraud": [
      "1930",
      "cyber fraud",
      "साइबर फ्रॉड",
      "साइबर ठगी"
    ],

    trafficking: [
      "trafficking",
      "तस्करी",
      "बेचने",
      "ले जाने"
    ],

    "missing-child": [
      "missing",
      "लापता",
      "गुम",
      "अकेला बच्चा"
    ],

    "self-harm": [
      "self-harm",
      "suicide",
      "मरना",
      "जान देना",
      "नुकसान"
    ],

    "online-safety": [
      "online",
      "internet",
      "social media",
      "photo",
      "इंटरनेट",
      "सोशल मीडिया",
      "फोटो"
    ],

    "violence-home": [
      "violence",
      "मारपीट",
      "घर",
      "डर",
      "हिंसा"
    ],

    "school-safety": [
      "school",
      "स्कूल",
      "teacher",
      "शिक्षक",
      "bullying"
    ],

    "child-rights": [
      "child rights",
      "बाल अधिकार",
      "education",
      "शिक्षा",
      "अधिकार"
    ],

    "trusted-adult": [
      "trusted adult",
      "भरोसेमंद",
      "मदद",
      "help"
    ]
  };

  return map[topic] || [];
}

/* =========================================================
   LOAD LOCAL KNOWLEDGE
========================================================= */

function loadLocalKnowledge() {
  try {
    if (fs.existsSync(KNOWLEDGE_FILE)) {
      const text = normalizeText(
        fs.readFileSync(
          KNOWLEDGE_FILE,
          "utf8"
        )
      );

      if (text) {
        documents.push({
          name: "knowledge.txt",
          text
        });
      }
    } else {
      console.log(
        "knowledge.txt not found. Using built-in child-safety knowledge."
      );
    }

    // Keep the existing knowledge and always add the built-in 100 Q&A.
    documents.push({
      name: "BAAL-SETU Child Safety 100 Q&A",
      text: CHILD_SAFETY_100_QA
    });

    rebuildChunks();

    console.log(
      `Local knowledge loaded: ${chunks.length} chunks`
    );

  } catch (error) {
    console.error(
      "knowledge.txt error:",
      error.message
    );
  }
}

/* =========================================================
   REBUILD SEARCH INDEX
========================================================= */

function rebuildChunks() {
  chunks = [];

  for (const document of documents) {
    if (!document.text) continue;

    const documentChunks =
      makeChunks(document.text);

    for (const text of documentChunks) {
      chunks.push({
        source: document.name,
        url: document.url || null,
        text
      });
    }
  }
}

/* =========================================================
   DOWNLOAD PDF
========================================================= */

async function downloadPdf(
  url,
  destination
) {
  const response = await fetch(
    url,
    {
      redirect: "follow"
    }
  );

  if (!response.ok) {
    throw new Error(
      `PDF download failed: HTTP ${response.status}`
    );
  }

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  fs.writeFileSync(
    destination,
    buffer
  );

  return buffer;
}

/* =========================================================
   LOAD SINGLE PDF
========================================================= */

async function ensurePdfLoaded(
  file,
  uploadToGemini = false
) {
  if (
    file.loaded &&
    (
      !uploadToGemini ||
      file.uploadedFile
    )
  ) {
    return file;
  }

  if (file.loading) {
    return file.loading;
  }

  file.loading = (async () => {
    const temporaryFile = path.join(
      os.tmpdir(),
      `baal-setu-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.pdf`
    );

    try {
      console.log(
        `Loading PDF: ${file.name}`
      );

      const buffer =
        await downloadPdf(
          file.url,
          temporaryFile
        );

      let extractedText = "";
      let pages = 0;

      /* ---------------------------------
         Extract PDF text
      --------------------------------- */

      try {
        const parsed =
          await pdfParse(buffer);

        extractedText =
          normalizeText(
            parsed.text
          );

        pages =
          parsed.numpages || 0;

      } catch (error) {
        console.warn(
          `PDF text extraction failed: ${file.name}`,
          error.message
        );
      }

      /* ---------------------------------
         Add / update document
      --------------------------------- */

      const existing =
        documents.find(
          (item) =>
            item.name === file.name
        );

      if (existing) {
        existing.text =
          extractedText ||
          existing.text;

        existing.pages =
          pages ||
          existing.pages;

      } else {
        documents.push({
          name: file.name,
          text: extractedText,
          url: file.url,
          pages
        });
      }

      if (extractedText) {
        rebuildChunks();
      }

      file.loaded = true;

      /* ---------------------------------
         Upload PDF to Gemini only when
         required
      --------------------------------- */

      if (
        uploadToGemini &&
        ai &&
        !file.uploadedFile
      ) {
        try {
          file.uploadedFile =
            await ai.files.upload({
              file: temporaryFile,
              config: {
                mimeType:
                  "application/pdf",
                displayName:
                  file.name
              }
            });

          console.log(
            `Gemini upload complete: ${file.name}`
          );

        } catch (error) {
          console.error(
            `Gemini upload failed: ${file.name}`,
            error.message
          );
        }
      }

      return file;

    } finally {
      file.loading = null;

      try {
        if (
          fs.existsSync(
            temporaryFile
          )
        ) {
          fs.unlinkSync(
            temporaryFile
          );
        }
      } catch {}
    }
  })();

  return file.loading;
}

/* =========================================================
   STOP WORDS
========================================================= */

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "what",
  "how",
  "why",
  "with",
  "from",
  "this",
  "that",
  "can",
  "does",
  "about",
  "according",
  "please",
  "tell",
  "give",
  "kya",
  "hai",
  "ka",
  "ki",
  "ke",
  "ko",
  "me",
  "mein",
  "se",
  "aur",
  "par",
  "ya",
  "hain",
  "kaise",
  "kiski",
  "kiske",
  "kis",
  "is",
  "of",
  "to",
  "in",
  "on",
  "a",
  "an"
]);

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(
      /[^a-z0-9\u0900-\u097f\s]/gi,
      " "
    )
    .split(/\s+/)
    .filter(
      (word) =>
        word.length >= 2 &&
        !STOP_WORDS.has(word)
    );
}

/* =========================================================
   RESOURCE DETECTION
========================================================= */

function sourceMatches(
  question,
  filename
) {
  const q =
    normalizeText(question)
      .toLowerCase();

  const name =
    filename.toLowerCase();

  if (
    /meena\s*(manch|munch)|मीना\s*मंच/i.test(
      q
    )
  ) {
    return /meena\s*(manch|munch)/i.test(
      name
    );
  }

  if (/cwpc/i.test(q)) {
    return /cwpc/i.test(name);
  }

  if (
    /child\s*trafficking|trafficking|बाल\s*तस्करी|तस्करी/i.test(
      q
    )
  ) {
    return /trafficking/i.test(
      name
    );
  }

  if (
    /kawach|कवच/i.test(q)
  ) {
    return /kawach/i.test(name);
  }

  if (
    /shg|self.?help\s*group/i.test(
      q
    )
  ) {
    return /shg/i.test(name);
  }

  if (
    /yojana|योजना|scheme/i.test(
      q
    )
  ) {
    return /yojana/i.test(name);
  }

  if (
    /bal\s*sanrakshan|बाल\s*संरक्षण/i.test(
      q
    )
  ) {
    return /bal\s*sanrakshan/i.test(
      name
    );
  }

  return false;
}

/* =========================================================
   SEARCH TEXT
========================================================= */

function searchTextChunks(
  question
) {
  const tokens = [
    ...new Set(
      tokenize(question)
    )
  ];

  const detectedTopics =
    detectTopics(question);

  if (
    !tokens.length &&
    !detectedTopics.length
  ) {
    return chunks.slice(0, 5);
  }

  return chunks
    .map((chunk) => {
      const text =
        chunk.text.toLowerCase();

      let score = 0;

      for (const token of tokens) {
        if (
          text.includes(token)
        ) {
          score += 5;
        }

        let count = 0;
        let position = 0;

        while (
          (
            position =
              text.indexOf(
                token,
                position
              )
          ) !== -1
        ) {
          count++;
          position += token.length;

          if (count >= 4) break;
        }

        score +=
          Math.min(
            count,
            4
          ) * 2;
      }

      for (
        const topic of detectedTopics
      ) {
        const terms =
          topicTerms(topic);

        let topicHits = 0;

        for (
          const term of terms
        ) {
          if (
            text.includes(
              term.toLowerCase()
            )
          ) {
            topicHits++;
          }
        }

        // Strong boost: topic intent matters more than individual words.
        score +=
          topicHits * 12;

        if (
          chunk.source ===
          "BAAL-SETU Child Safety 100 Q&A"
        ) {
          score +=
            topicHits * 10;
        }
      }

      return {
        ...chunk,
        score
      };
    })
    .filter(
      (item) =>
        item.score > 0
    )
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(0, 5);
}

/* =========================================================
   FIND RELEVANT PDFS
========================================================= */

async function getRelevantPdfs(
  question
) {
  const matched =
    pdfFiles
      .filter((file) =>
        sourceMatches(
          question,
          file.name
        )
      )
      .slice(0, 2);

  if (!matched.length) {
    return [];
  }

  /*
    Only matching PDFs are downloaded.
    This is the main speed improvement.
  */

  await Promise.all(
    matched.map((file) =>
      ensurePdfLoaded(
        file,
        Boolean(ai)
      )
    )
  );

  return matched;
}

/* =========================================================
   GEMINI SYSTEM INSTRUCTIONS
========================================================= */

const SYSTEM_INSTRUCTIONS = `
You are BAAL-SETU Child Protection Chatbot for children, adolescents, parents, teachers, communities and frontline workers in India.

Your answers must be safe, accurate, practical and child-friendly.

MANDATORY RESPONSE FORMAT:

English:
[Answer directly and clearly.]

Hindi:
[Give the same answer in simple Hindi.]

Do not start with:
"According to the document..."
"According to the PDF..."
"According to the supplied resources..."
or similar source-preface language unless the user specifically asks for the source.

SOURCE ACCURACY:

- Supplied child-protection resources are an important source of information.
- If a user names a specific module/resource, prioritize that resource.
- Do not mix unrelated resources when a specific resource is requested.
- Use the supplied resources when they contain relevant information.
- If the supplied resources do not contain the answer, you may provide a helpful general answer using reliable general knowledge.
- Never invent facts.
- Never guess acronym expansions.
- Never invent laws, sections, penalties, procedures, government orders or official contacts.
- Do not claim that information comes from a supplied resource unless it is actually supported by that resource.

UNKNOWN / NO RELIABLE ANSWER:

If you genuinely do not have enough reliable information to answer the user's question, respond EXACTLY in this format and do not add anything else:

English:
I’m sorry, I don’t have enough reliable information to answer this question. Please ask a question related to child protection. Contact 1098/112 if you need immediate help.

Hindi:
क्षमा करें, इस सवाल का विश्वसनीय जवाब मेरे पास उपलब्ध नहीं है। कृपया बाल संरक्षण से संबंधित सवाल पूछें। तत्काल सहायता के लिए 1098 या 112 पर संपर्क करें.

IMPORTANT:
- Never expose internal verification wording or internal knowledge-base limitations to the user.
- Never mention internal resources, PDFs, documents or the knowledge base when using the fallback response.
- Do not give a made-up answer just to avoid the fallback response.
- Use the fallback response only when you genuinely lack enough reliable information.

SAFETY:

- If a child is in immediate danger, advise moving to a safe place and contacting a trusted adult.
- Emergency support: 112.
- Child Helpline: 1098.
- Never ask for passwords, OTPs, Aadhaar numbers, bank details, exact home address or unnecessary identifying information.
- Never promise secrecy.
- Do not blame, shame, threaten or pressure a child.
- For sexual abuse, trafficking, violence, child marriage, child labour, exploitation, neglect, missing children, online safety or self-harm, prioritize immediate safety and real-world support.
- If self-harm or suicide is mentioned, encourage immediate trusted-adult and emergency support. Never provide methods.
- Legal information is general information, not legal advice.

STYLE:

- Be concise.
- Use simple language.
- Use bullet points when useful.
- Answer the user's actual question directly.
- Avoid unnecessary repetition.
- Do not create unsupported statistics.
- Be calm, respectful and non-judgmental.
- If the user asks a general child-protection question, answer it when reliable information is available.
- If the question is outside child protection and you do not have enough reliable information, use the exact fallback response.
`;

/* =========================================================
   EXPRESS MIDDLEWARE
========================================================= */

app.disable(
  "x-powered-by"
);

app.use(
  express.json({
    limit: "32kb"
  })
);

app.use(
  express.static(
    __dirname,
    {
      etag: true,
      maxAge: "1h",

      setHeaders: (
        res,
        filePath
      ) => {
        if (
          filePath.endsWith(
            ".html"
          )
        ) {
          res.setHeader(
            "Cache-Control",
            "no-cache"
          );
        }
      }
    }
  )
);

/* =========================================================
   HOME
========================================================= */

app.get(
  "/",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );
  }
);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  "/health",
  (req, res) => {
    res.status(200).json({
      status: "ok",

      service:
        "BAAL-SETU Child Protection Chatbot",

      ai:
        ai
          ? "Gemini"
          : "not-configured",

      knowledgeBase:
        knowledgeReady
          ? "ready"
          : "loading",

      localChunks:
        chunks.length,

      loadedPdfs:
        pdfFiles.filter(
          (file) =>
            file.loaded
        ).length,

      geminiPdfs:
        pdfFiles.filter(
          (file) =>
            file.uploadedFile
        ).length
    });
  }
);

/* =========================================================
   KNOWLEDGE STATUS
========================================================= */

app.get(
  "/api/knowledge-status",
  (req, res) => {
    res.status(200).json({
      status: "ok",

      knowledgeBase:
        knowledgeReady
          ? "ready"
          : "loading",

      searchableChunks:
        chunks.length,

      loadedPdfs:
        pdfFiles.filter(
          (file) =>
            file.loaded
        ).length,

      geminiPdfFiles:
        pdfFiles.filter(
          (file) =>
            file.uploadedFile
        ).length,

      sources:
        documents.map(
          (doc) =>
            doc.name
        )
    });
  }
);

/* =========================================================
   GEMINI RESPONSE
========================================================= */

async function generateResponse(
  message
) {
  if (!ai) {
    throw new Error(
      "GEMINI_API_KEY is not configured."
    );
  }

  /*
    Load ONLY relevant PDFs.
  */

  const relevantPdfs =
    await getRelevantPdfs(
      message
    );

  /*
    Search locally available text.
  */

  const matches =
    searchTextChunks(
      message
    );

  const textContext =
    matches.length
      ? matches
          .map(
            (
              item,
              index
            ) =>
              `TEXT SOURCE ${index + 1}: ${item.source}\n${item.text}`
          )
          .join(
            "\n\n---\n\n"
          )
      : "No relevant extracted text was found.";

  const sourceInstruction =
    relevantPdfs.length
      ? `
The user has specifically asked about:
${relevantPdfs
  .map(
    (file) =>
      file.name
  )
  .join(", ")}

Use these supplied PDF resources as the primary source when relevant.
`
      : `
Use the relevant supplied knowledge text when applicable.
If it does not contain enough information, use reliable general knowledge.
`;

  const contents = [];

  /*
    Attach only the PDFs relevant
    to the current question.
  */

  for (
    const file of relevantPdfs
  ) {
    if (
      file.uploadedFile?.uri &&
      file.uploadedFile?.mimeType
    ) {
      contents.push(
        createPartFromUri(
          file.uploadedFile.uri,
          file.uploadedFile
            .mimeType
        )
      );
    }
  }

  contents.push(`
${sourceInstruction}

USER QUESTION:
${message}

RELEVANT SEARCH TEXT:
${textContext}
`);

  const response =
    await ai.models.generateContent(
      {
        /*
          Keep the lightweight model
          for faster response.
        */

        model:
          "gemini-3.5-flash-lite",

        contents:
          createUserContent(
            contents
          ),

        config: {
          systemInstruction:
            SYSTEM_INSTRUCTIONS,

          maxOutputTokens:
            500,

          thinkingConfig: {
            thinkingLevel:
              "minimal"
          }
        }
      }
    );

  const answer =
    response.text?.trim();

  if (!answer) {
    return FALLBACK_RESPONSE;
  }

  /*
    Extra protection:
    If Gemini returns an old internal
    replace it with the new fallback.
  */

  return answer;
}

/* =========================================================
   CHAT API
========================================================= */

app.post(
  "/api/chat",
  async (
    req,
    res
  ) => {
    try {
      const message =
        String(
          req.body?.message ||
            ""
        ).trim();

      if (!message) {
        return res
          .status(400)
          .json({
            error:
              "Please enter a question."
          });
      }

      if (
        message.length >
        4000
      ) {
        return res
          .status(400)
          .json({
            error:
              "Question is too long. Please keep it under 4000 characters."
          });
      }

      if (
        !process.env
          .GEMINI_API_KEY
      ) {
        return res
          .status(503)
          .json({
            error:
              "AI service is not configured yet."
          });
      }

      const answer =
        await generateResponse(
          message
        );

      return res.json({
        answer
      });

    } catch (error) {
      console.error(
        "BAAL-SETU ERROR:",
        error?.message ||
          error
      );

      return res
        .status(503)
        .json({
          error:
            "BAAL-SETU is temporarily busy. Please try again in a few seconds. If you need immediate help, contact 1098 or 112."
        });
    }
  }
);

/* =========================================================
   404
========================================================= */

app.use(
  (
    req,
    res
  ) => {
    res
      .status(404)
      .json({
        error:
          "Page or API endpoint not found."
      });
  }
);

/* =========================================================
   START SERVER IMMEDIATELY
========================================================= */

const server =
  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        `BAAL-SETU running on port ${PORT}`
      );

      console.log(
        "Server started immediately."
      );

      console.log(
        "Knowledge base will initialize in background."
      );

      /*
        IMPORTANT:
        Local knowledge loads AFTER
        the server has already started.
      */

      setImmediate(
        () => {
          try {
            loadLocalKnowledge();

            knowledgeReady =
              true;

            console.log(
              "Knowledge base ready."
            );

          } catch (
            error
          ) {
            console.error(
              "Knowledge initialization error:",
              error.message
            );

            knowledgeReady =
              false;
          }
        }
      );
    }
  );

/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

function shutdown(
  signal
) {
  console.log(
    `${signal} received. Closing server...`
  );

  server.close(
    () => {
      console.log(
        "Server closed."
      );

      process.exit(0);
    }
  );

  setTimeout(
    () => {
      process.exit(1);
    },
    10000
  );
}

process.on(
  "SIGTERM",
  () =>
    shutdown(
      "SIGTERM"
    )
);

process.on(
  "SIGINT",
  () =>
    shutdown(
      "SIGINT"
    )
);

/* =========================================================
   UNHANDLED ERRORS
========================================================= */

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "Unhandled promise rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "Uncaught exception:",
      error
    );
  }
);
