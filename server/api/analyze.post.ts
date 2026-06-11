import { GoogleGenAI } from '@google/genai'
import { createEventStream } from 'h3'

const SYSTEM_PROMPT = `あなたは物語テキストを解析する専門家です。
以下の【絶対厳守の制約】に従い、与えられた物語テキストから登場人物の情報と相関関係を抽出してください。

【絶対厳守の制約】
- "relationships"（関係性）について：物語テキストに登場する全ての登場人物を抽出すること。登場人物間の関係性は、会話内容（セリフ・対話・やり取り）を根拠として判断すること。ただし、会話内容が無くても関係性が存在する場合は、それを含めること。すべてのエッジは有向（from → to）で表現すること。双方向の関係は必ず2エントリに分割すること。双方向に分割する場合、両エントリのlabelは同じである必要はない。それぞれの from 側の人物の視点に基づき、最も適したlabelを個別に選択すること。一方向の関係は1エントリのみ。labelは必ず以下の【関係性定義リスト】の「英語（日本語）」形式のラベルのみを使用すること（リスト外の自由記述は絶対禁止）。charactersに含まれるすべてのキャラクターは、必ず1つ以上のrelationshipエントリ（fromまたはtoのいずれか）に登場すること。

  【関係性定義リスト（labelに使用できるラベル: 英語（日本語）形式）】
  - "Acquaintance Of (AはBの知り合い)": A person having more than slight or superficial knowledge of this person but short of friendship
  - "Ambivalent Of (AはBに複雑な感情を抱く相手)": A person towards whom this person has mixed feelings or emotions
  - "Ancestor Of (AはBの祖先)": A person who is a descendant of this person
  - "Antagonist Of (AはBの対立相手)": A person who opposes and contends against this person
  - "Apprentice To (AはBの弟子 / 徒弟)": A person to whom this person serves as a trusted counselor or teacher
  - "Child Of (AはBの子供)": A person who was given birth to or nurtured and raised by this person
  - "Close Friend Of (AはBの親友)": A person who shares a close mutual friendship with this person
  - "Collaborates With (AはBの共同作業者 / 協力者)": A person who works towards a common goal with this person
  - "Colleague Of (AはBの同僚)": A person who is a member of the same profession as this person
  - "Descendant Of (AはBの子孫)": A person from whom this person is descended
  - "Employed By (AはBの被雇用者 / 従業員)": A person for whom this person's services have been engaged
  - "Employer Of (AはBの雇用主)": A person who engages the services of this person
  - "Enemy Of (AはBの敵)": A person towards whom this person feels hatred, intends injury to, or opposes the interests of
  - "Engaged To (AはBの婚約者)": A person to whom this person is betrothed
  - "Friend Of (AはBの友人)": A person who shares mutual friendship with this person
  - "Grandchild Of (AはBの孫)": A person who is a child of any of this person's children
  - "Grandparent Of (AはBの祖父母)": A person who is the parent of any of this person's parents
  - "Has Met (AはBと会ったことがある)": A person who has met this person whether in passing or longer
  - "Influenced By (AはBに影響を受けた)": A person who has influenced this person
  - "Knows By Reputation (AはBを評判で知っている)": A person known by this person primarily for a particular action, position or field of endeavour
  - "Knows In Passing (AはBを少し知っている)": A person whom this person has slight or superficial knowledge of
  - "Knows Of (AはBの存在を知っている)": A person who has come to be known to this person through their actions or position
  - "Life Partner of (AはBのライフパートナー)": A person who has made a long-term commitment to this person
  - "Lives With (AはBの同居人)": A person who shares a residence with this person
  - "Lost Contact With (AはBと音信不通 / 連絡が途絶えた)": A person who was once known by this person but has subsequently become uncontactable
  - "Mentor Of (AはBのメンター / 指導者)": A person who serves as a trusted counselor or teacher to this person
  - "Neighbor Of (AはBの隣人 / 近所の人)": A person who lives in the same locality as this person
  - "Parent Of (AはBの親)": A person who has given birth to or nurtured and raised this person
  - "Sibling Of (AはBの兄弟姉妹)": A person having one or both parents in common with this person
  - "Spouse Of (AはBの配偶者)": A person who is married to this person
  - "Works With (AはBと一緒に働く人)": A person who works for the same employer as this person
  - "Would Like To Know (AはBと知り合いたい)": A person whom this person would desire to know more closely

- 出力はJSON形式のみとし、余計な説明文やコードブロック記号（\`\`\`json等）は一切含めないこと。

【出力JSONスキーマ】
{
  "characters": [
    { "id": "c1", "name": "キャラクター名" }
  ],
  "relationships": [
    { "from": "c1", "to": "c2", "label": "関係性のラベル" }
  ]
}

idは登場順に c1, c2, c3 ... と付与してください。`

type GeminiResponse = {
  characters: { id: string; name: string }[]
  relationships: { from: string; to: string; label: string }[]
}

export default defineEventHandler(async (event) => {
  event.node.req.socket?.setTimeout(120_000)

  const config = useRuntimeConfig()
  const apiKey = config.geminiApiKey

  if (!apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Missing API Key',
      message: 'GEMINI_API_KEY が設定されていません。.env ファイルを確認してください。',
    })
  }

  const body = await readBody(event)
  const storyText = body?.text?.trim()

  if (!storyText) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '物語テキストが空です。',
    })
  }

  const eventStream = createEventStream(event)

  void (async () => {
    try {
      const ai = new GoogleGenAI({ apiKey })

      const geminiStream = await ai.models.generateContentStream({
        model: 'gemini-3.5-flash',
        config: {
          systemInstruction: SYSTEM_PROMPT,
          maxOutputTokens: 65536,
          temperature: 0.0,
          seed: 42,
          responseMimeType: 'application/json',
        },
        contents: `【物語テキスト】\n${storyText}`,
      })

      let fullText = ''
      let charCount = 0
      let finishReason: string | undefined
      let tokenCount = 0

      for await (const chunk of geminiStream) {
        const text = chunk.text ?? ''
        fullText += text
        charCount += text.length
        finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason
        tokenCount = chunk.usageMetadata?.candidatesTokenCount ?? tokenCount

        await eventStream.push({
          data: JSON.stringify({ type: 'progress', chars: charCount }),
        })
      }

      console.log(`[Gemini] finishReason=${finishReason} candidatesTokens=${tokenCount}`)

      if (finishReason === 'MAX_TOKENS') {
        await eventStream.push({
          data: JSON.stringify({
            type: 'error',
            message: `Gemini の出力がトークン上限に達しました（${tokenCount} tokens）。入力テキストを短くして再試行してください。`,
          }),
        })
        return
      }

      const rawText = fullText.trim()
      if (!rawText) {
        await eventStream.push({
          data: JSON.stringify({ type: 'error', message: 'Gemini からの応答が空でした。' }),
        })
        return
      }

      const start = rawText.indexOf('{')
      const end = rawText.lastIndexOf('}')
      const jsonCandidate = start !== -1 && end !== -1
        ? rawText.slice(start, end + 1)
        : rawText

      let parsed: GeminiResponse
      try {
        parsed = JSON.parse(jsonCandidate)
      } catch (parseErr) {
        console.error('[JSON parse failed]', parseErr)
        await eventStream.push({
          data: JSON.stringify({
            type: 'error',
            message: `Gemini の応答をJSONとして解析できませんでした。応答の先頭: ${jsonCandidate.slice(0, 200)}`,
          }),
        })
        return
      }

      await eventStream.push({
        data: JSON.stringify({ type: 'done', result: parsed }),
      })
    } catch (err: unknown) {
      const e = err as { status?: number; statusCode?: number; message?: string }
      const httpStatus = e?.status ?? e?.statusCode ?? 0

      let message = `Gemini API エラー (${httpStatus}): ${e?.message ?? String(err)}`
      if (httpStatus === 429) {
        message = 'Gemini API のレート制限に達しました。しばらく待ってから再試行してください。'
      } else if (httpStatus === 404) {
        message = '指定したモデルが見つかりません（404）。モデル名を確認してください。'
      }

      await eventStream.push({
        data: JSON.stringify({ type: 'error', message }),
      })
    } finally {
      await eventStream.close()
    }
  })()

  return eventStream.send()
})
