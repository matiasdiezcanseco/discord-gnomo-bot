# Frases y fotos por intención, entregadas textualmente

Las frases y fotos de la colección del Gnomo ya no se reconocen con un patrón fijo en código («dame una frase», «mándame una foto aleatoria»…) que saltaba el modelo. El modelo decide por la intención de la petición actual, dicha de cualquier forma, si llama `collection_phrase` o `collection_photo`; una frase inventada o sobre un tema concreto no usa la colección.

Para conservar lo que daba la ruta directa, estas herramientas son **textuales** (`verbatim` en `Capability`): su resultado se entrega tal cual, nunca reescrito por el modelo. Si un turno solo pidió herramientas textuales, la respuesta sale en ese mismo turno, sin un segundo paso del modelo; si la respuesta final combinada omite el contenido, el harness lo agrega sin cambios.

Se acepta una llamada al modelo por petición de frase/foto (antes cero) a cambio de reconocer cualquier forma de pedirla. Reemplaza la «ruta rápida sin modelo» de [T03](../tickets/gnomo-refactor/03-frases-fotos-rapidas.md) y del spec; como en recordatorios y recuerdos ([ADR 0002](0002-explicit-memory-only.md)), no queda ninguna puerta por palabras clave.

Una foto se entrega **sola** (`standalone`): el mensaje contiene únicamente la URL, para que Discord muestre la vista previa en el chat. Cualquier texto del modelo va en un mensaje aparte, y si el modelo incluyó la URL en su texto, se le quita.
