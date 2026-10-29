/**
 * Mothers' portal content: WHO postpartum danger signs and a parent reading list.
 * Every link is an official WHO page, opened and checked on 2026-10-29. Summaries are deliberately general.
 * Kazakh wording was drafted for the demo; a native-speaking clinician should review it before launch.
 */

// keys must match DANGER_SIGNS in backend/routers/maternal.py
export const DANGER_SIGNS = [
  ['bleeding', { ru: 'Сильное кровотечение (прокладка промокает за час или выходят крупные сгустки)', kz: 'Қатты қан кету (төсеме бір сағатта толық суланады немесе ірі ұйындылар шығады)', en: 'Heavy bleeding (soaking a pad within an hour, or passing large clots)' }],
  ['fever', { ru: 'Температура 38 °C и выше, озноб', kz: 'Дене қызуы 38 °C және одан жоғары, қалтырау', en: 'Temperature of 38 °C or higher, chills' }],
  ['headache_vision', { ru: 'Сильная головная боль или нарушение зрения', kz: 'Қатты бас ауруы немесе көрудің бұзылуы', en: 'Severe headache or blurred vision' }],
  ['seizure', { ru: 'Судороги или потеря сознания', kz: 'Құрысу немесе есінен тану', en: 'Seizures or fainting' }],
  ['breathing_chest', { ru: 'Трудно дышать или боль в груди', kz: 'Тыныс алу қиын немесе кеуде ауырады', en: 'Difficulty breathing or chest pain' }],
  ['abdominal_pain', { ru: 'Сильная боль в животе', kz: 'Іштің қатты ауыруы', en: 'Severe abdominal pain' }],
  ['discharge', { ru: 'Выделения с неприятным запахом', kz: 'Жағымсыз иісті бөліністер', en: 'Foul-smelling discharge' }],
  ['leg_swelling', { ru: 'Боль, покраснение или отёк одной ноги', kz: 'Бір аяқтың ауыруы, қызаруы немесе ісінуі', en: 'Pain, redness or swelling in one leg' }],
  ['self_harm', { ru: 'Мысли причинить вред себе или ребёнку', kz: 'Өзіңізге немесе балаңызға зиян келтіру туралы ойлар', en: 'Thoughts of harming yourself or your baby' }],
];

export const MOODS = [
  [1, '😣', { ru: 'Очень плохо', kz: 'Өте нашар', en: 'Very bad' }],
  [2, '😟', { ru: 'Плохо', kz: 'Нашар', en: 'Bad' }],
  [3, '😐', { ru: 'Так себе', kz: 'Орташа', en: 'So-so' }],
  [4, '🙂', { ru: 'Хорошо', kz: 'Жақсы', en: 'Good' }],
  [5, '😊', { ru: 'Отлично', kz: 'Тамаша', en: 'Great' }],
];

const TOPIC = {
  preterm: { ru: 'Недоношенность', kz: 'Шала туылу', en: 'Prematurity' },
  feeding: { ru: 'Кормление', kz: 'Тамақтандыру', en: 'Feeding' },
  kangaroo: { ru: 'Кенгуру-уход', kz: 'Кенгуру күтімі', en: 'Kangaroo care' },
  postnatal: { ru: 'После родов', kz: 'Босанғаннан кейін', en: 'After birth' },
};
export const TOPICS = Object.entries(TOPIC);

export const PARENT_MATERIALS = [
  { topic: 'preterm', lang: 'RU', title: 'Преждевременные роды', source: 'ВОЗ · информационный бюллетень', url: 'https://www.who.int/ru/news-room/fact-sheets/detail/preterm-birth',
    summary: { ru: 'Что такое преждевременные роды и какой уход помогает таким малышам: тепло, кормление, контакт кожа к коже.', kz: 'Шала туу дегеніміз не және мұндай сәбилерге қандай күтім көмектеседі: жылу, тамақтандыру, тері мен терінің жанасуы.', en: 'What preterm birth is and which care helps these babies: warmth, feeding, skin-to-skin contact.' } },
  { topic: 'feeding', lang: 'RU', title: 'Кормление детей грудного и раннего возраста', source: 'ВОЗ · информационный бюллетень', url: 'https://www.who.int/ru/news-room/fact-sheets/detail/infant-and-young-child-feeding',
    summary: { ru: 'Почему грудное молоко так важно и что рекомендует ВОЗ в первые месяцы жизни.', kz: 'Ана сүті неге маңызды және ВОЗ алғашқы айларда не ұсынады.', en: 'Why breast milk matters and what WHO recommends in the first months of life.' } },
  { topic: 'feeding', lang: 'RU', title: 'Грудное вскармливание: информационный бюллетень (Европейский регион)', source: 'ВОЗ / ЮНИСЕФ · 2024', url: 'https://www.who.int/europe/ru/publications/i/item/WHO-EURO-2024-10632-50404-76100',
    summary: { ru: 'Краткая сводка ВОЗ и ЮНИСЕФ о грудном вскармливании и поддержке мам в странах региона.', kz: 'ВОЗ пен ЮНИСЕФ-тің емізу және өңір елдеріндегі аналарды қолдау туралы қысқа шолуы.', en: 'A short WHO/UNICEF summary on breastfeeding and how mothers are supported across the region.' } },
  { topic: 'kangaroo', lang: 'EN', title: 'Kangaroo mother care: a transformative innovation in health care', source: 'ВОЗ · 2023', url: 'https://www.who.int/publications/i/item/9789240072657',
    summary: { ru: 'Метод «кенгуру»: малыш лежит на груди мамы кожа к коже. ВОЗ объясняет, чем это помогает недоношенным.', kz: '«Кенгуру» әдісі: сәби анасының кеудесінде тері мен теріге жатады. ВОЗ мұның шала туған балаларға пайдасын түсіндіреді.', en: 'Skin-to-skin “kangaroo” care and why it helps preterm babies, explained by WHO.' } },
  { topic: 'preterm', lang: 'EN', title: 'WHO recommendations for care of the preterm or low-birth-weight infant', source: 'ВОЗ · 2022', url: 'https://www.who.int/publications/i/item/9789240058262',
    summary: { ru: 'Рекомендации ВОЗ по уходу за недоношенными и маловесными детьми, в том числе об участии семьи.', kz: 'Шала туған және салмағы аз балаларды күту бойынша ВОЗ ұсыныстары, отбасының қатысуын қоса алғанда.', en: 'WHO guidance on caring for preterm and low-birth-weight babies, including family involvement.' } },
  { topic: 'postnatal', lang: 'EN', title: 'WHO recommendations on maternal and newborn care for a positive postnatal experience', source: 'ВОЗ · 2022', url: 'https://www.who.int/publications/i/item/9789240045989',
    summary: { ru: 'Как заботиться о себе и малыше после родов: осмотры, тревожные признаки, самочувствие мамы.', kz: 'Босанғаннан кейін өзіңізге және сәбиге қалай қамқорлық жасау: тексерулер, қауіпті белгілер, ананың жағдайы.', en: 'Caring for yourself and your baby after birth: check-ups, danger signs, your wellbeing.' } },
];

export const topicLabel = (key, lang) => TOPIC[key]?.[lang] || TOPIC[key]?.en || key;
