import { generateText, stepCountIs } from 'ai'
import { openai } from '@ai-sdk/openai'
import { getTools } from '../actions/registry.ts'

export interface ActionResult {
  actionName: string | null
  text: string | null
}

export async function selectAction(userMessage: string): Promise<ActionResult> {
  try {
    const result = await generateText({
      model: openai('gpt-4o-mini'),
      tools: getTools(),
      toolChoice: 'auto',
      stopWhen: stepCountIs(2),
      system: `Eres un asistente de bot de Discord. Responde siempre en español. Según el mensaje del usuario, determina qué acción ejecutar.
Llama a una herramienta si la solicitud del usuario coincide con una de las acciones disponibles. Es posible que te escriban las acciones de forma corta, por ejemplo: "frase" o "pic". Tambien pueden llamarlas de forma imprevista como: "rota una foto" o "dame una frase".
Si la solicitud no coincide con ninguna acción, no llames a ninguna herramienta. Si retornas algun recurso como imagenes o frases, solo retorna el texto del recurso, no agregues ningun texto adicional. Nunca respondas a peticiones que no tienen relacion con las acciones disponibles. En caso pregunten otras cosas, recuerdales lo que puedes hacer.`,
      prompt: userMessage
    })

    return {
      actionName: null,
      text: result.text
    }
  } catch (error) {
    console.error('Error selecting action:', error)
    return {
      actionName: null,
      text: null
    }
  }
}

