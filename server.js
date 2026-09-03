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

/* =========================================================
   ADDITIONAL CHILD SAFETY KNOWLEDGE – 100 PRACTICAL Q&A
========================================================= */

const ADDITIONAL_CHILD_SAFETY_KNOWLEDGE = `
1. प्रश्न: कोई गलत तरीके से छुए तो क्या करें?
उत्तर: तुरंत सुरक्षित जगह जाएँ, किसी भरोसेमंद बड़े को बताएँ और जरूरत हो तो 1098 या 112 पर मदद लें।

2. प्रश्न: Good Touch और Bad Touch क्या है?
उत्तर: Good Touch में बच्चा सुरक्षित और सहज महसूस करता है। ऐसा स्पर्श जो असहज, डरावना या निजी अंगों से जुड़ा हो, unsafe हो सकता है।

3. प्रश्न: कोई कहे कि यह बात किसी को मत बताना तो?
उत्तर: डराने या गलत तरीके से छिपाने वाले secrets नहीं रखने चाहिए। भरोसेमंद बड़े को बताना सही है।

4. प्रश्न: कोई धमकी दे तो क्या करें?
उत्तर: अकेले सामना न करें। सुरक्षित जगह जाएँ और भरोसेमंद बड़े या 112/1098 से सहायता लें।

5. प्रश्न: घर में डर लगता है तो?
उत्तर: किसी भरोसेमंद बड़े, शिक्षक या बाल संरक्षण सहायता से बात करें। तत्काल खतरा हो तो 112 पर संपर्क करें।

6. प्रश्न: कोई ऑनलाइन फोटो माँगे तो?
उत्तर: निजी या असहज फोटो न भेजें। बातचीत का रिकॉर्ड सुरक्षित रखें, ब्लॉक/रिपोर्ट करें और भरोसेमंद बड़े को बताएं।

7. प्रश्न: निजी फोटो वायरल करने की धमकी मिले तो?
उत्तर: पैसे या दूसरी मांग पूरी न करें। सबूत सुरक्षित रखें, अकाउंट रिपोर्ट करें और भरोसेमंद बड़े तथा जरूरत पर 1930/112 से मदद लें।

8. प्रश्न: Instagram/WhatsApp पर परेशान किया जाए तो?
उत्तर: जवाब देने के बजाय ब्लॉक/रिपोर्ट करें, स्क्रीनशॉट रखें और किसी भरोसेमंद बड़े को बताएं।

9. प्रश्न: Cyberbullying क्या है?
उत्तर: इंटरनेट या डिजिटल माध्यम से बार-बार डराना, अपमानित करना, धमकाना या परेशान करना cyberbullying हो सकता है।

10. प्रश्न: सोशल मीडिया अकाउंट hack हो जाए तो?
उत्तर: पासवर्ड बदलें, दूसरे डिवाइस/सेशन से logout करें, two-factor authentication चालू करें और जरूरत हो तो प्लेटफॉर्म पर रिपोर्ट करें।

11. प्रश्न: Password कैसा होना चाहिए?
उत्तर: मजबूत और अलग password रखें। किसी के साथ password साझा न करें।

12. प्रश्न: ऑनलाइन दोस्त मिलने के लिए बुलाए तो?
उत्तर: अकेले मिलने न जाएँ। भरोसेमंद बड़े को बताएं और अपनी location/व्यक्तिगत जानकारी साझा न करें।

13. प्रश्न: POCSO क्या है?
उत्तर: POCSO Act बच्चों को sexual offences से सुरक्षा देने वाला कानून है।

14. प्रश्न: Sexual abuse होने पर क्या बच्चे की गलती है?
उत्तर: नहीं। जिम्मेदारी गलत व्यवहार करने वाले व्यक्ति की है। बच्चे को दोष या शर्म नहीं दी जानी चाहिए।

15. प्रश्न: अगर आरोपी कोई जान-पहचान या रिश्तेदार हो तो?
उत्तर: फिर भी बच्चे की सुरक्षा सबसे पहले है। भरोसेमंद बड़े या संबंधित child-protection authority को बताना चाहिए।

16. प्रश्न: कोई sexual बात के लिए दबाव या धमकी दे तो?
उत्तर: वहाँ से सुरक्षित निकलें, अकेले न रहें और भरोसेमंद बड़े/1098/112 से सहायता लें।

17. प्रश्न: Child Marriage क्या है?
उत्तर: 18 वर्ष से कम उम्र की लड़की या 21 वर्ष से कम उम्र के लड़के का विवाह बाल विवाह की श्रेणी में आता है।

18. प्रश्न: जबरदस्ती शादी कराई जा रही हो तो?
उत्तर: तुरंत भरोसेमंद बड़े, स्थानीय प्रशासन/पुलिस या 1098 से सहायता लें। तत्काल खतरा हो तो 112 पर संपर्क करें।

19. प्रश्न: दोस्त की शादी कम उम्र में हो रही हो तो?
उत्तर: किसी भरोसेमंद बड़े या संबंधित अधिकारी को तुरंत जानकारी दें।

20. प्रश्न: बाल विवाह की सूचना कहाँ दें?
उत्तर: 1098, 112 या स्थानीय प्रशासन/पुलिस को सूचना दी जा सकती है।

21. प्रश्न: Child Labour क्या है?
उत्तर: बच्चे से ऐसा काम करवाना जो कानून, शिक्षा, सुरक्षा या उसके विकास के अधिकारों का उल्लंघन करे, child labour की समस्या हो सकती है।

22. प्रश्न: दुकान/होटल में बच्चे से जबरन काम कराया जा रहा हो तो?
उत्तर: बच्चे की सुरक्षा प्राथमिकता है। स्वयं टकराव न करें; 1098 या संबंधित अधिकारी/पुलिस को सूचना दें।

23. प्रश्न: कहीं बच्चा मजदूरी करता दिखे तो?
उत्तर: बच्चे से सुरक्षित तरीके से बात करें, उसे दोष न दें और 1098 या संबंधित अधिकारी को सूचना दें।

24. प्रश्न: गरीबी के कारण बच्चा काम कर रहा हो तो?
उत्तर: परिवार को सामाजिक सुरक्षा, शिक्षा और सहायता योजनाओं से जोड़ने की जरूरत हो सकती है। बच्चे की शिक्षा और सुरक्षा प्राथमिकता है।

25. प्रश्न: शिक्षक बच्चे को मारता है तो?
उत्तर: बच्चे को शारीरिक हिंसा से सुरक्षा मिलनी चाहिए। भरोसेमंद बड़े और स्कूल के उचित अधिकारी को जानकारी दें।

26. प्रश्न: स्कूल में bullying हो तो?
उत्तर: भरोसेमंद शिक्षक/अभिभावक को बताएं, घटनाओं का रिकॉर्ड रखें और अकेले बदला लेने की कोशिश न करें।

27. प्रश्न: स्कूल में sexual harassment हो तो?
उत्तर: तुरंत भरोसेमंद वयस्क/स्कूल की उचित व्यवस्था को बताएं। गंभीर मामले में 1098/112 से सहायता लें।

28. प्रश्न: स्कूल में भेदभाव हो तो?
उत्तर: भरोसेमंद शिक्षक, प्रधानाध्यापक या अभिभावक से बात करें और जरूरत पर संबंधित child-rights mechanism से सहायता लें।

29. प्रश्न: Child Protection Committee क्या करती है?
उत्तर: स्थानीय स्तर पर बच्चों की सुरक्षा, जोखिम की पहचान, सहायता और referral/convergence में भूमिका निभा सकती है।

30. प्रश्न: घर में मारपीट होती हो तो?
उत्तर: सुरक्षित जगह जाएँ, भरोसेमंद बड़े को बताएं और तत्काल खतरे में 112 पर संपर्क करें।

31. प्रश्न: घर से निकालने की धमकी मिले तो?
उत्तर: अकेले न रहें। भरोसेमंद बड़े, child-protection service या 1098 से मदद लें।

32. प्रश्न: घर में सुरक्षित महसूस न हो तो?
उत्तर: किसी सुरक्षित भरोसेमंद व्यक्ति के पास जाएँ और सहायता लें। तत्काल खतरे में 112।

33. प्रश्न: किसी बच्चे को जबरन कहीं भेजा जा रहा हो तो?
उत्तर: बच्चे की सुरक्षा सुनिश्चित करें और 1098/112 या संबंधित अधिकारी को तुरंत सूचना दें।

34. प्रश्न: बच्चा खुद लापता हो जाए तो?
उत्तर: तुरंत परिवार/भरोसेमंद व्यक्ति और पुलिस को सूचना दें। आपात स्थिति में 112 से संपर्क करें।

35. प्रश्न: दोस्त लापता हो जाए तो?
उत्तर: परिवार/भरोसेमंद बड़े को बताएं और पुलिस को सूचना देने में मदद करें।

36. प्रश्न: रेलवे स्टेशन पर बच्चा अकेला मिले तो?
उत्तर: बच्चे को सुरक्षित रखें और Railway/Police/Child Helpline 1098 की सहायता लें।

37. प्रश्न: Child Trafficking क्या है?
उत्तर: बच्चों को शोषण, जबरन काम, यौन शोषण या अन्य उद्देश्य से भर्ती/ले जाने जैसी गतिविधियाँ trafficking हो सकती हैं।

38. प्रश्न: नौकरी का लालच देकर दूसरे शहर ले जाने की बात हो तो?
उत्तर: बिना सत्यापन और भरोसेमंद बड़े की जानकारी के न जाएँ। संदेह हो तो 1098/112 से सहायता लें।

39. प्रश्न: किसी बच्चे को जबरन ले जाया जा रहा हो तो?
उत्तर: तुरंत 112 या 1098 पर सूचना दें और स्वयं जोखिम में न पड़ें।

40. प्रश्न: बच्चा cigarette/vape इस्तेमाल कर रहा हो तो?
उत्तर: डाँटने या शर्मिंदा करने के बजाय सुरक्षित बातचीत करें, भरोसेमंद वयस्क/काउंसलर की मदद लें और जरूरत पर स्वास्थ्य सहायता लें।

41. प्रश्न: बच्चा alcohol/drugs इस्तेमाल करता हो तो?
उत्तर: बच्चे को दोष न दें। भरोसेमंद वयस्क और qualified health/de-addiction support से मदद लें।

42. प्रश्न: दोस्त drugs इस्तेमाल करता हो तो?
उत्तर: उसे अकेले संभालने की कोशिश न करें। किसी भरोसेमंद बड़े या योग्य सहायता सेवा को बताएं।

43. प्रश्न: बहुत डर लग रहा हो तो?
उत्तर: सुरक्षित व्यक्ति के पास जाएँ, धीरे-धीरे साँस लें और किसी भरोसेमंद बड़े से बात करें।

44. प्रश्न: बहुत emotional distress हो तो?
उत्तर: अकेले न रहें। भरोसेमंद व्यक्ति से बात करें और जरूरत हो तो mental-health professional की मदद लें।

45. प्रश्न: बार-बार अपमानित किया जाए तो?
उत्तर: यह सामान्य नहीं है। भरोसेमंद बड़े/शिक्षक को बताएं और जरूरत पर child-protection support लें।

46. प्रश्न: घर में रोज झगड़ा होता हो तो?
उत्तर: बच्चे को बीच में जाकर जोखिम नहीं लेना चाहिए। सुरक्षित स्थान और भरोसेमंद बड़े की सहायता लें।

47. प्रश्न: लगे कि कोई मेरी बात नहीं सुनता तो?
उत्तर: किसी दूसरे भरोसेमंद वयस्क, शिक्षक, counselor या 1098 से बात करें।

48. प्रश्न: Child Rights क्या हैं?
उत्तर: बच्चों को सुरक्षा, शिक्षा, स्वास्थ्य, विकास, सम्मान और अपनी बात रखने सहित कई अधिकार प्राप्त हैं।

49. प्रश्न: Education का अधिकार क्या है?
उत्तर: 6–14 वर्ष के बच्चों के लिए RTE Act के तहत निःशुल्क और अनिवार्य शिक्षा का प्रावधान है।

50. प्रश्न: स्कूल admission से मना करे तो?
उत्तर: अभिभावक स्कूल/शिक्षा विभाग से बात करें और लागू नियमों के अनुसार सहायता लें।

51. प्रश्न: काम के लिए स्कूल छोड़ने को मजबूर किया जा रहा हो तो?
उत्तर: भरोसेमंद बड़े/शिक्षक से बात करें और बच्चे को शिक्षा व सामाजिक सहायता से जोड़ने की कोशिश करें।

52. प्रश्न: कोई password माँगे तो?
उत्तर: password साझा न करें।

53. प्रश्न: कोई OTP माँगे तो?
उत्तर: OTP कभी साझा न करें।

54. प्रश्न: कोई personal information माँगे तो?
उत्तर: जरूरत के बिना नाम, पता, स्कूल, फोन या अन्य निजी जानकारी साझा न करें।

55. प्रश्न: ऑनलाइन कोई डराए तो?
उत्तर: जवाब देने के बजाय सबूत रखें, block/report करें और भरोसेमंद बड़े को बताएं।

56. प्रश्न: कोई inappropriate photo/video भेजे तो?
उत्तर: आगे forward न करें, सुरक्षित तरीके से रिपोर्ट करें, सबूत रखें और भरोसेमंद बड़े को बताएं।

57. प्रश्न: ऑनलाइन मिलने के बदले पैसे देने की बात हो तो?
उत्तर: न जाएँ, निजी जानकारी साझा न करें और भरोसेमंद बड़े को बताएं।

58. प्रश्न: कोई location माँगे तो?
उत्तर: अपनी live/exact location अनजान व्यक्ति को न दें।

59. प्रश्न: कोई school का नाम या address पूछे तो?
उत्तर: अनजान व्यक्ति को स्कूल की location या अन्य निजी जानकारी साझा न करें।

60. प्रश्न: secret online relationship हो तो?
उत्तर: यदि इससे डर, दबाव या असहजता हो रही है तो भरोसेमंद बड़े से बात करें।

61. प्रश्न: कोई uncomfortable message भेजे तो?
उत्तर: जवाब न देना, block/report करना और भरोसेमंद बड़े को बताना सुरक्षित विकल्प है।

62. प्रश्न: कोई पैसे या gift का लालच दे तो?
उत्तर: लालच में निजी जानकारी, फोटो या मिलने की सहमति न दें।

63. प्रश्न: कोई खुद को police बताकर डराए तो?
उत्तर: व्यक्तिगत जानकारी या पैसे न दें। किसी भरोसेमंद बड़े से सत्यापन कराएं।

64. प्रश्न: कोई बाहर अकेले मिलने के लिए कहे तो?
उत्तर: अकेले न जाएँ। भरोसेमंद बड़े को बताएं।

65. प्रश्न: कोई gift देकर uncomfortable काम करवाना चाहे तो?
उत्तर: साफ मना करें और भरोसेमंद बड़े को बताएं।

66. प्रश्न: जबरदस्ती photo/video बनवाया जाए तो?
उत्तर: सुरक्षित जगह जाएँ, भरोसेमंद बड़े को बताएं और जरूरत पर 1098/112 से सहायता लें।

67. प्रश्न: कोई adult डरे हुए बच्चे को कहीं ले जा रहा हो तो?
उत्तर: यदि सुरक्षित हो तो तुरंत किसी भरोसेमंद वयस्क/पुलिस/1098 को सूचना दें। स्वयं खतरे में न पड़ें।

68. प्रश्न: बच्चा घर वापस नहीं जाना चाहता तो?
उत्तर: उसकी बात शांतिपूर्वक सुनें और उसे सुरक्षित भरोसेमंद वयस्क/child-protection support से जोड़ें।

69. प्रश्न: कोई बच्चा abuse के बारे में बताए तो क्या करें?
उत्तर: उसकी बात विश्वास से सुनें, दोष न दें, सुरक्षित रखें और उचित सहायता/रिपोर्टिंग व्यवस्था से जोड़ें।

70. प्रश्न: बच्चे को abuse के लिए blame करना चाहिए?
उत्तर: नहीं। बच्चे को blame, shame या threaten नहीं करना चाहिए।

71. प्रश्न: बच्चा डर के कारण बोल नहीं पा रहा हो तो?
उत्तर: उसे समय दें, सुरक्षित वातावरण दें और दबाव न डालें।

72. प्रश्न: abuse बताने पर चुप रहने की धमकी मिले तो?
उत्तर: बच्चे को अकेला न छोड़ें और तुरंत भरोसेमंद वयस्क/1098/112 की सहायता लें।

73. प्रश्न: Child Helpline 1098 क्या है?
उत्तर: 1098 बच्चों से संबंधित सहायता और child-protection support के लिए Child Helpline है।

74. प्रश्न: 112 क्या है?
उत्तर: 112 भारत का integrated emergency number है। तत्काल खतरे या emergency में संपर्क किया जा सकता है।

75. प्रश्न: 1930 क्या है?
उत्तर: 1930 National Cyber Crime Helpline है, विशेषकर cyber/online financial fraud की शिकायत में सहायता के लिए।

76. प्रश्न: 1098 और 112 में क्या अंतर है?
उत्तर: 1098 बच्चों से संबंधित सहायता के लिए Child Helpline है। 112 emergency response के लिए है।

77. प्रश्न: ऑनलाइन पैसे की धोखाधड़ी हो जाए तो?
उत्तर: तुरंत 1930 पर संपर्क करें और संबंधित cybercrime reporting व्यवस्था का उपयोग करें।

78. प्रश्न: Fake social media account बन गया हो तो?
उत्तर: platform पर report करें, सबूत सुरक्षित रखें और भरोसेमंद बड़े को बताएं।

79. प्रश्न: फोटो पर abusive comments आएँ तो?
उत्तर: comments का screenshot रखें, account block/report करें और भरोसेमंद बड़े को बताएं।

80. प्रश्न: ऑनलाइन मेरे बारे में झूठ फैलाया जाए तो?
उत्तर: सबूत सुरक्षित रखें, platform पर report करें और भरोसेमंद वयस्क/स्कूल authority से सहायता लें।

81. प्रश्न: कोई डरावना link भेजे तो?
उत्तर: link पर क्लिक न करें और उसे report/delete करें। संदेह हो तो भरोसेमंद बड़े से मदद लें।

82. प्रश्न: online job के नाम पर documents माँगे जाएँ तो?
उत्तर: बिना सत्यापन Aadhaar, bank details, OTP या अन्य sensitive documents साझा न करें।

83. प्रश्न: BAAL-SETU से किस तरह के सवाल पूछ सकते हैं?
उत्तर: Child safety, child rights, child marriage, child labour, POCSO, cyber safety, bullying, trafficking, missing children और सहायता से जुड़े सवाल पूछ सकते हैं।

84. प्रश्न: समझ नहीं आ रहा किससे मदद माँगूँ तो?
उत्तर: किसी भरोसेमंद वयस्क, शिक्षक या 1098 से बात करें। तत्काल खतरे में 112।

85. प्रश्न: कोई trusted adult उपलब्ध न हो तो?
उत्तर: 1098 या 112 से सहायता लें, विशेषकर यदि तत्काल खतरा हो।

86. प्रश्न: दूसरे बच्चे के बारे में चिंता हो तो?
उत्तर: बच्चे को दोष न दें और किसी भरोसेमंद वयस्क/1098/112 को जानकारी दें।

87. प्रश्न: आज ही child marriage होने वाली हो तो?
उत्तर: तुरंत 1098, 112, पुलिस या स्थानीय प्रशासन को सूचना दें।

88. प्रश्न: बच्चे से जबरन मजदूरी कराई जा रही हो तो?
उत्तर: बच्चे की सुरक्षा प्राथमिकता है। 1098 या संबंधित अधिकारी/पुलिस को सूचना दें।

89. प्रश्न: कोई बच्चा अकेला मिला हो तो?
उत्तर: उसे सुरक्षित रखें और 1098/112 या संबंधित पुलिस/child-protection service की सहायता लें।

90. प्रश्न: बच्चे की फोटो social media पर डाल दी गई हो तो?
उत्तर: privacy settings और platform reporting का उपयोग करें। यदि फोटो sensitive/abusive हो तो भरोसेमंद वयस्क और संबंधित authorities से मदद लें।

91. प्रश्न: कोई exact location share करने को कहे तो?
उत्तर: live location या exact address साझा न करें।

92. प्रश्न: कोई बच्चा self-harm की बात करे तो?
उत्तर: बच्चे को अकेला न छोड़ें, किसी भरोसेमंद वयस्क को तुरंत बताएं और तत्काल खतरे में 112 से सहायता लें।

93. प्रश्न: बच्चा कहे कि वह मरना चाहता है तो?
उत्तर: इसे गंभीरता से लें। बच्चे को अकेला न छोड़ें और तुरंत भरोसेमंद वयस्क/112 की सहायता लें। किसी भी self-harm method की जानकारी न दें।

94. प्रश्न: बच्चा घर जाने से डरता हो तो?
उत्तर: उसे सुरक्षित स्थान दें, उसकी बात सुनें और 1098/112 या उचित child-protection support से मदद लें।

95. प्रश्न: बच्चा abuse की बात बताए तो क्या कहना चाहिए?
उत्तर: “मैं तुम्हारी बात सुन रहा/रही हूँ”, “तुम्हारी गलती नहीं है” और “हम तुम्हारी सुरक्षा के लिए मदद लेंगे” जैसे supportive शब्द कहें।

96. प्रश्न: क्या बच्चा अपनी समस्या खुद report कर सकता है?
उत्तर: हाँ, बच्चा सहायता माँग सकता है और अपनी सुरक्षा से संबंधित समस्या किसी भरोसेमंद व्यक्ति/1098/112 को बता सकता है।

97. प्रश्न: क्या BAAL-SETU हिंदी में मदद कर सकता है?
उत्तर: हाँ, आप हिंदी में child-protection से संबंधित सवाल पूछ सकते हैं।

98. प्रश्न: BAAL-SETU से क्या-क्या पूछा जा सकता है?
उत्तर: बच्चों की सुरक्षा, अधिकार, online safety, child marriage, child labour, POCSO, bullying, trafficking, missing children और emergency सहायता से जुड़े प्रश्न पूछे जा सकते हैं।

99. प्रश्न: अगर तुरंत मदद चाहिए तो?
उत्तर: तत्काल खतरे में 112 और बच्चों से संबंधित सहायता के लिए 1098 से संपर्क करें।

100. प्रश्न: अगर समझ न आए कि समस्या child protection से जुड़ी है या नहीं?
उत्तर: स्थिति बताकर सहायता पूछ सकते हैं। यदि बच्चा असुरक्षित है या तत्काल खतरा है तो 112/1098 से सहायता लें।

SAFETY REMINDER:
- Password, OTP, bank details, Aadhaar number, exact home address या अनावश्यक personal information साझा न करें।
- बच्चे को blame, shame, threaten या pressure न करें।
- तत्काल खतरे में safety और real-world help को प्राथमिकता दें।
`;

/* =========================================================
   KNOWLEDGE BASE
========================================================= */

let chunks = [];
let knowledgeReady = false;

/* =========================================================
   TOKENIZER
========================================================= */

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(
      (token) =>
        token.length >= 2
    );
}

/* =========================================================
   CHUNK TEXT
========================================================= */

function chunkText(
  text,
  source,
  maxLength = 1800
) {
  const clean = String(
    text || ""
  ).trim();

  if (!clean) {
    return [];
  }

  const paragraphs = clean
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const result = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (
      current &&
      current.length +
        paragraph.length +
        2 >
        maxLength
    ) {
      result.push({
        source,
        text: current
      });

      current = paragraph;
    } else {
      current += current
        ? `\n\n${paragraph}`
        : paragraph;
    }
  }

  if (current) {
    result.push({
      source,
      text: current
    });
  }

  return result;
}

/* =========================================================
   REBUILD SEARCH INDEX
========================================================= */

function rebuildChunks() {
  chunks = [];

  for (const doc of documents) {
    chunks.push(
      ...chunkText(
        doc.text,
        doc.name
      )
    );
  }

  console.log(
    `Search index rebuilt: ${chunks.length} chunks`
  );
}

/* =========================================================
   LOAD LOCAL KNOWLEDGE
========================================================= */

function loadLocalKnowledge() {
  documents = [];

  if (
    fs.existsSync(
      KNOWLEDGE_FILE
    )
  ) {
    try {
      const text =
        fs.readFileSync(
          KNOWLEDGE_FILE,
          "utf8"
        );

      if (text.trim()) {
        documents.push({
          name: "knowledge.txt",
          text
        });

        console.log(
          "knowledge.txt loaded."
        );
      }
    } catch (error) {
      console.error(
        "knowledge.txt loading error:",
        error.message
      );
    }
  }

  /*
    Add the 100 practical child-safety
    questions to the same searchable
    knowledge base.
  */

  documents.push({
    name:
      "BAAL-SETU Child Safety Q&A",
    text:
      ADDITIONAL_CHILD_SAFETY_KNOWLEDGE
  });

  rebuildChunks();

  console.log(
    `Local knowledge loaded: ${documents.length} sources`
  );
}

/* =========================================================
   PDF HELPERS
========================================================= */

async function downloadPdf(
  url
) {
  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      `PDF download failed: ${response.status}`
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  return Buffer.from(
    arrayBuffer
  );
}

async function extractPdfText(
  buffer
) {
  const result =
    await pdfParse(buffer);

  return (
    result.text || ""
  ).trim();
}

/* =========================================================
   LOAD PDF
========================================================= */

async function ensurePdfLoaded(
  file,
  uploadToGemini = false
) {
  if (
    file.loaded &&
    (!uploadToGemini ||
      file.uploadedFile)
  ) {
    return file;
  }

  if (file.loading) {
    await file.loading;
    return file;
  }

  file.loading =
    (async () => {
      try {
        console.log(
          `Loading PDF: ${file.name}`
        );

        const buffer =
          await downloadPdf(
            file.url
          );

        const text =
          await extractPdfText(
            buffer
          );

        file.loaded = true;

        if (text) {
          documents.push({
            name: file.name,
            text
          });

          rebuildChunks();
        }

        /*
          Upload PDF to Gemini only when
          the current question actually
          needs this PDF.
        */

        if (
          uploadToGemini &&
          ai
        ) {
          try {
            const tempDir =
              await fs.promises.mkdtemp(
                path.join(
                  os.tmpdir(),
                  "baal-setu-"
                )
              );

            const tempPath =
              path.join(
                tempDir,
                file.name
              );

            await fs.promises.writeFile(
              tempPath,
              buffer
            );

            file.uploadedFile =
              await ai.files.upload({
                file: tempPath,
                config: {
                  mimeType:
                    "application/pdf",
                  displayName:
                    file.name
                }
              });

            console.log(
              `Gemini PDF uploaded: ${file.name}`
            );
          } catch (uploadError) {
            console.error(
              `Gemini PDF upload error (${file.name}):`,
              uploadError.message
            );
          }
        }

        console.log(
          `PDF ready: ${file.name}`
        );
      } catch (error) {
        console.error(
          `PDF loading error (${file.name}):`,
          error.message
        );

        file.loaded = false;
      } finally {
        file.loading = null;
      }
    })();

  await file.loading;

  return file;
}

/* =========================================================
   SOURCE MATCHING
========================================================= */

function sourceMatches(
  question,
  name
) {
  const q =
    String(question || "")
      .toLowerCase();

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
    return /kawach/i.test(
      name
    );
  }

  if (
    /shg|self.?help\s*group/i.test(
      q
    )
  ) {
    return /shg/i.test(
      name
    );
  }

  if (
    /yojana|योजना|scheme/i.test(
      q
    )
  ) {
    return /yojana/i.test(
      name
    );
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

  if (!tokens.length) {
    return chunks.slice(
      0,
      5
    );
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
          (position =
            text.indexOf(
              token,
              position
            )) !== -1
        ) {
          count++;

          position +=
            token.length;

          if (count >= 4) {
            break;
          }
        }

        score +=
          Math.min(
            count,
            4
          ) * 2;
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
    .slice(
      0,
      5
    );
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
      .slice(
        0,
        2
      );

  if (!matched.length) {
    return [];
  }

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
   BAAL-SETU SYSTEM INSTRUCTIONS
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
or similar source-preface language unless the user specifically asks for the source.

SOURCE ACCURACY:

- Supplied child-protection resources are an important source of information.
- If a user names a specific module/resource, prioritize that resource.
- Do not mix unrelated resources when a specific resource is requested.
- Use the supplied resources when they contain relevant information.
- The BAAL-SETU Child Safety Q&A knowledge should be used for practical child-safety questions.
- If the supplied resources do not contain the answer, you may provide a helpful general answer using reliable general knowledge.
- Never invent facts.
- Never guess acronym expansions.
- Never invent laws, sections, penalties, procedures, government orders or official contacts.
- Do not claim that information comes from a particular resource unless it is actually supported by that resource.

UNKNOWN / NO RELIABLE ANSWER:

If you genuinely do not have enough reliable information to answer the user's question, respond EXACTLY in this format and do not add anything else:

English:
I’m sorry, I don’t have enough reliable information to answer this question. Please ask a question related to child protection. Contact 1098/112 if you need immediate help.

Hindi:
माफ़ कीजिए, इस प्रश्न का विश्वसनीय उत्तर देने के लिए मेरे पास पर्याप्त जानकारी नहीं है। कृपया बाल संरक्षण से संबंधित प्रश्न पूछें। तत्काल सहायता के लिए 1098/112 पर संपर्क करें।

IMPORTANT:

- Never mention internal resources, PDFs, documents or knowledge base when using the fallback response.
- Do not give a made-up answer just to avoid the fallback response.
- Use the fallback response only when you genuinely lack enough reliable information.

SAFETY:

- If a child is in immediate danger, advise moving to a safe place and contacting a trusted adult.
- Emergency support: 112.
- Child Helpline: 1098.
- Cyber Crime Helpline: 1930 for relevant cyber/online financial fraud matters.
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
          (doc) => doc.name
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

  const relevantPdfs =
    await getRelevantPdfs(
      message
    );

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

  for (
    const file of relevantPdfs
  ) {
    if (
      file.uploadedFile?.uri &&
      file.uploadedFile?.mimeType
    ) {
      contents.push(
        createPartFromUri(
          file.uploadedFile
            .uri,
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
        model:
          "gemini-3.5-flash-lite",

        contents:
          createUserContent(
            contents
          ),

        config: {
          systemInstruction:
            SYSTEM_INSTRUCTIONS,

          maxOutputTokens: 500,

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
   START SERVER
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

      setImmediate(() => {
        try {
          loadLocalKnowledge();

          knowledgeReady =
            true;

          console.log(
            "Knowledge base ready."
          );

        } catch (error) {
          console.error(
            "Knowledge initialization error:",
            error.message
          );

          knowledgeReady =
            false;
        }
      });
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

  server.close(() => {
    console.log(
      "Server closed."
    );

    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 10000);
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
