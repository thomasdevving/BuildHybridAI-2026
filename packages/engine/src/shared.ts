import PHQ2 from "../../../shared/questionnaires/PHQ2.json";
import PHQ9 from "../../../shared/questionnaires/PHQ9.json";
import momentary from "../../../shared/questionnaires/momentary.json";
import banned from "../../../shared/safety/banned_output_words.json";
import crisisKeywords from "../../../shared/safety/crisis_keywords.en.json";
import crisisLines from "../../../shared/safety/crisis_lines.json";

export interface QuestionnaireDef {
  id: string;
  title: string;
  verbatim: boolean;
  stem: string;
  options: { label: string; value: number }[];
  items: { n: number; text: string; safety_item?: boolean }[];
  scoring: { total: string; range: number[]; bands?: { min: number; max: number; id: string }[] };
}

/** Data files from /shared, bundled so that both apps load the same text. */
export const shared = {
  questionnaires: { PHQ2: PHQ2 as QuestionnaireDef, PHQ9: PHQ9 as QuestionnaireDef, momentary },
  safety: {
    bannedWords: banned.words as string[],
    crisisKeywords: crisisKeywords.phrases as string[],
    crisisLines,
  },
};
