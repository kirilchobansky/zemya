/** Language-family and religion-group lookups, used only to tag each country record. */
const LANG_FAMILIES = {
  'Indo-European': ['English', 'Spanish', 'Portuguese', 'French', 'Italian', 'German', 'Dutch', 'Russian', 'Ukrainian', 'Belarusian', 'Polish', 'Czech', 'Slovak', 'Slovene', 'Croatian', 'Serbian', 'Bosnian', 'Bulgarian', 'Macedonian', 'Montenegrin', 'Romanian', 'Moldovan', 'Greek', 'Albanian', 'Armenian', 'Persian', 'Pashto', 'Dari', 'Urdu', 'Hindi', 'Bengali', 'Nepali', 'Sinhala', 'Punjabi', 'Marathi', 'Kurdish', 'Tajik', 'Danish', 'Swedish', 'Norwegian', 'Norwegian Bokmål', 'Norwegian Nynorsk', 'Icelandic', 'Faroese', 'Latvian', 'Lithuanian', 'Irish', 'Welsh', 'Scottish Gaelic', 'Luxembourgish', 'Catalan', 'Romansh', 'Afrikaans', 'Dhivehi', 'Hindustani', 'Papiamento', 'Sranan Tongo', 'Haitian Creole', 'Balochi', 'Ossetian', 'Serbo-Croatian', 'Portuguese Creole'],
  'Afro-Asiatic': ['Arabic', 'Hebrew', 'Amharic', 'Tigrinya', 'Somali', 'Berber', 'Maltese', 'Hausa', 'Oromo'],
  'Sino-Tibetan': ['Chinese', 'Mandarin', 'Burmese', 'Dzongkha', 'Tibetan'],
  'Niger-Congo': ['Swahili', 'Zulu', 'Xhosa', 'Shona', 'Kinyarwanda', 'Kirundi', 'Lingala', 'Kikongo', 'Tswana', 'Sotho', 'Southern Sotho', 'Northern Sotho', 'Chewa', 'Chichewa', 'Sango', 'Kikuyu', 'Wolof', 'Fula', 'Yoruba', 'Igbo', 'Comorian', 'Swati', 'Ndebele', 'Tsonga', 'Venda', 'Tumbuka', 'Umbundu', 'Kongo', 'Luba-Katanga'],
  'Austronesian': ['Indonesian', 'Malay', 'Filipino', 'Tagalog', 'Javanese', 'Fijian', 'Samoan', 'Tongan', 'Māori', 'Malagasy', 'Marshallese', 'Nauru', 'Palauan', 'Chamorro', 'Tetum', 'Hiri Motu', 'Gilbertese', 'Tok Pisin', 'Bislama'],
  'Turkic': ['Turkish', 'Azerbaijani', 'Kazakh', 'Uzbek', 'Kyrgyz', 'Turkmen', 'Tatar'],
  'Austroasiatic': ['Vietnamese', 'Khmer'],
  'Tai-Kadai': ['Thai', 'Lao'],
  'Japonic / Koreanic': ['Japanese', 'Korean'],
  'Uralic': ['Finnish', 'Estonian', 'Hungarian'],
  'Other families': ['Georgian', 'Basque', 'Quechua', 'Aymara', 'Guaraní', 'Greenlandic', 'Mongolian', 'Nauruan', 'Papuan', 'Creole', 'Seychellois Creole', 'Mauritian Creole', 'French Creole']
};
export const familyOf = (() => {
  const m = {};
  for (const fam of Object.keys(LANG_FAMILIES)) for (const l of LANG_FAMILIES[fam]) if (!(l in m)) m[l] = fam;
  return lang => m[lang] || 'Other families';
})();

/** Coarse grouping used only for the choropleth legend. The specific value authored in
 *  the YAML is what the dossier and the quizzes use. */
export function religionGroup(r) {
  if (/Islam/i.test(r)) return 'Islam';
  if (/Judaism/i.test(r)) return 'Judaism';
  if (/Hindu/i.test(r)) return 'Hinduism';
  if (/Buddh/i.test(r)) return 'Buddhism';
  if (/Christian|Catholic|Protest|Orthodox|Anglican/i.test(r)) return 'Christianity';
  if (/Shinto|folk|Vodun|Vodou|ancestor|traditional/i.test(r)) return 'Folk / traditional';
  if (/Athe|no religion|Juche|Secular/i.test(r)) return 'Secular / none';
  return 'Other';
}
