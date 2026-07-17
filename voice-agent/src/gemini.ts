import Groq from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Groq client. It automatically picks up GROQ_API_KEY from environment.
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || ''
});

const MODEL_NAME = 'llama-3.3-70b-versatile';

export interface ConversationTurn {
  role: 'user' | 'model';
  text: string;
}

/**
 * Classifies the user's utterance into one of the 5 pre-defined intents using Groq.
 */
export async function classifyIntent(utterance: string): Promise<string> {
  const prompt = `
You are an intent classifier for an advisor appointment scheduling system.
Classify the following user utterance into exactly one of these intents:
- INTENT_BOOK: User wants to book a new appointment or consultation.
- INTENT_RESCHEDULE: User wants to change, move, or reschedule an existing appointment.
- INTENT_CANCEL: User wants to cancel or delete an existing appointment.
- INTENT_PREPARE: User asks what they need to prepare, what documents are required, or what to bring.
- INTENT_AVAILABILITY: User asks about general availability or next available slots, but has not yet initiated booking.

User Utterance: "${utterance}"

Return ONLY the intent code (e.g. INTENT_BOOK). Do not return any other text, markdown formatting, or explanation.
`;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'user' as const, content: prompt }
      ],
      model: MODEL_NAME,
      temperature: 0.1
    });

    const intent = (chatCompletion.choices[0]?.message?.content || '').trim();
    
    if (intent.includes('INTENT_BOOK')) return 'INTENT_BOOK';
    if (intent.includes('INTENT_RESCHEDULE')) return 'INTENT_RESCHEDULE';
    if (intent.includes('INTENT_CANCEL')) return 'INTENT_CANCEL';
    if (intent.includes('INTENT_PREPARE')) return 'INTENT_PREPARE';
    if (intent.includes('INTENT_AVAILABILITY')) return 'INTENT_AVAILABILITY';
    
    return 'INTENT_BOOK'; // Default fallback
  } catch (error) {
    console.error('[Groq] Intent classification failed:', error);
    return 'INTENT_BOOK';
  }
}

/**
 * Generates a contextual voice response based on system instructions and dialogue history using Groq.
 */
export async function generateAgentResponse(systemInstruction: string, conversationHistory: ConversationTurn[]): Promise<string> {
  try {
    // Map history to standard chat completion roles ('system', 'user', 'assistant')
    const messages = [
      { role: 'system' as const, content: systemInstruction },
      ...conversationHistory.map(turn => ({
        role: turn.role === 'model' ? 'assistant' as const : 'user' as const,
        content: turn.text
      }))
    ];

    const chatCompletion = await groq.chat.completions.create({
      messages,
      model: MODEL_NAME,
      temperature: 0.3
    });

    return (chatCompletion.choices[0]?.message?.content || '').trim();
  } catch (error) {
    console.error('[Groq] Response generation failed:', error);
    return "I'm sorry, I encountered an issue. How can I help you schedule your appointment?";
  }
}
