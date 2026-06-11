<template>
  <div class="layout">
    <!-- 左ペイン: 入力 + 相関図/JSON -->
    <div class="main-pane">
      <!-- 折り畳み可能な上部パネル -->
      <div class="top-panel" :class="{ collapsed: isTopCollapsed }">
        <header class="app-header">
          <div class="header-left">
            <h1>物語テキスト → キャラクター相関図</h1>
            <div v-if="fileMetadata" class="file-meta">
              <span v-if="fileMetadata.title" class="file-meta-title">📖 {{ fileMetadata.title }}</span>
              <span v-if="fileMetadata.subtitleRange" class="file-meta-subtitle">{{ fileMetadata.subtitleRange }}</span>
            </div>
          </div>
          <div class="experiment-controls">
            <button class="export-btn" @click="exportExperimentData">実験データの保存</button>
            <button class="export-btn aggregate-btn" @click="showAggregateModal = true">📊 まとめ比較</button>
          </div>
        </header>

        <!-- テキスト入力エリア -->
        <div class="input-section">
          <textarea
            v-model="storyText"
            class="story-input"
            placeholder="ここに物語のテキストを貼り付けてください..."
            rows="5"
          />

          <!-- ファイルアップロード（統合） -->
          <div
            class="upload-zone"
            :class="{ 'drag-over': isDragOver }"
            @click="fileInputRef?.click()"
            @dragover.prevent="isDragOver = true"
            @dragleave.prevent="isDragOver = false"
            @drop.prevent="onAllFileDrop"
          >
            <span class="upload-icon">📂</span>
            <span class="upload-text">Excel / CSV / JSON / TXT をドラッグ＆ドロップ、またはクリックして選択</span>
            <span v-if="uploadedFileNames.length" class="upload-filename">{{ uploadedFileNames.join('、') }}</span>
          </div>
          <input
            ref="fileInputRef"
            type="file"
            accept=".xlsx,.xls,.csv,.json,.txt"
            multiple
            class="hidden-file-input"
            @change="onAllFileChange"
          />
          <p v-if="uploadError" class="error-msg">{{ uploadError }}</p>

          <div class="action-row">
            <button
              class="analyze-btn"
              :disabled="isLoading || !storyText.trim()"
              @click="analyze"
            >
              {{ isLoading ? (receivedChars > 0 ? `解析中... 受信 ${receivedChars.toLocaleString()} 文字` : '解析中...') : '解析実行' }}
            </button>
          </div>
          <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>
        </div>
      </div>

      <!-- 折り畳みハンドル -->
      <button class="collapse-handle" @click="isTopCollapsed = !isTopCollapsed" :title="isTopCollapsed ? '上部パネルを展開' : '上部パネルを折り畳む'">
        <span class="collapse-chevron" :class="{ up: isTopCollapsed }">▲</span>
      </button>

      <!-- タブ切り替え -->
      <div v-if="result" class="tab-bar">
        <button :class="['tab-btn', activeTab === 'graph' ? 'active' : '']" @click="activeTab = 'graph'">相関図</button>
        <button :class="['tab-btn', activeTab === 'json' ? 'active' : '']" @click="activeTab = 'json'">JSONデータ</button>
        <div class="tab-bar-right">
          <!-- 作品切り替えピッカー (2作品以上のとき表示) -->
          <div v-if="workSlots.length > 1" class="work-picker-wrapper" @click.stop>
            <button class="work-picker-btn" @click="showWorkPicker = !showWorkPicker">
              作品を変更：{{ currentWork?.label }} ▾
            </button>
            <div v-show="showWorkPicker" class="work-picker-dropdown">
              <button
                v-for="work in workSlots"
                :key="work.id"
                :class="['work-picker-item', currentWork?.id === work.id ? 'active' : '']"
                @click="switchWork(work.id); showWorkPicker = false"
              >{{ work.label }}</button>
            </div>
          </div>
          <button class="download-btn" @click="downloadJson">⬇ JSONをダウンロード</button>
          <template v-if="!gtResult">
            <button class="download-btn gt-load-btn" @click="gtFileInputRef?.click()">📂 正解JSON読込</button>
          </template>
          <template v-else>
            <button class="download-btn f1-export-btn" @click="exportF1Sheet">⬇ F1比較エクスポート</button>
            <button class="gt-clear-btn" @click="setGtResult(null)" title="正解データをクリア">✕</button>
          </template>
          <input ref="gtFileInputRef" type="file" accept=".json" class="hidden-file-input" @change="onGtFileChange" />
        </div>
      </div>

      <!-- 未解析スロット表示 -->
      <div v-if="currentWork && !currentWork.result" class="no-result-pane">
        <p>テキストを読み込みました。解析を実行してください。</p>
      </div>

      <!-- 相関図（作品ごとに独立したコンテナ、v-showで全保持） -->
      <div
        v-for="work in workSlots"
        :key="work.id"
        v-show="currentWork?.id === work.id && activeTab === 'graph' && work.result"
        :ref="(el) => registerContainer(work.id, el as Element | null)"
        class="network-container"
      />

      <!-- JSONデータ -->
      <div v-if="result && activeTab === 'json'" class="json-view">
        <pre>{{ JSON.stringify({ title: fileMetadata?.title ?? '', ...result }, null, 2) }}</pre>
      </div>
    </div>

    <!-- 右ペイン: 関係性サイドバー -->
    <aside class="sidebar">
      <h2>キャラクター詳細</h2>

      <template v-if="result">
        <!-- フィルタ中バッジ -->
        <div v-if="selectedChar" class="interaction-filter-badge">
          <span>{{ selectedChar.name }} でフィルタ中</span>
          <button class="clear-filter-btn" @click="selectedChar = null; resetEdgeStyles()">✕ 全表示</button>
        </div>

        <!-- 選択なし: 全件（送り手名前順） -->
        <template v-if="!selectedChar">
          <div class="detail-card">
            <div class="detail-card-label">すべての関係性</div>
            <ul v-if="displayedRelationships.length" class="interaction-list">
              <li v-for="(rel, i) in displayedRelationships" :key="i" class="interaction-item">
                <div class="interaction-chars">{{ rel.fromName }} → {{ rel.toName }}</div>
                <div class="interaction-label">{{ rel.label }}</div>
              </li>
            </ul>
            <p v-else class="detail-card-body muted">（関係性なし）</p>
          </div>
        </template>

        <!-- 選択あり: 送り手・受け手に分割 -->
        <template v-else>
          <div class="detail-card">
            <div class="detail-card-label">動作主（{{ selectedChar.name }} →）</div>
            <ul v-if="outgoingRelationships.length" class="interaction-list">
              <li v-for="(rel, i) in outgoingRelationships" :key="i" class="interaction-item">
                <div class="interaction-chars">→ {{ rel.toName }}</div>
                <div class="interaction-label">{{ rel.label }}</div>
              </li>
            </ul>
            <p v-else class="detail-card-body muted">（なし）</p>
          </div>
          <div class="detail-card">
            <div class="detail-card-label">受動者（→ {{ selectedChar.name }}）</div>
            <ul v-if="incomingRelationships.length" class="interaction-list">
              <li v-for="(rel, i) in incomingRelationships" :key="i" class="interaction-item">
                <div class="interaction-chars">{{ rel.fromName }} →</div>
                <div class="interaction-label">{{ rel.label }}</div>
              </li>
            </ul>
            <p v-else class="detail-card-body muted">（なし）</p>
          </div>
        </template>
      </template>
      <p v-else class="sidebar-hint">解析を実行すると関係性が表示されます</p>
    </aside>

    <!-- まとめ比較モーダル -->
    <div v-if="showAggregateModal" class="aggregate-modal-overlay" @click.self="showAggregateModal = false">
      <div class="aggregate-modal">
        <div class="aggregate-modal-header">
          <span>📊 まとめ比較</span>
          <button class="aggregate-modal-close" @click="showAggregateModal = false">✕</button>
        </div>
        <div
          class="aggregate-drop-zone"
          :class="{ 'drag-over': isAggregateDragOver }"
          @dragover.prevent="isAggregateDragOver = true"
          @dragleave.prevent="isAggregateDragOver = false"
          @drop.prevent="onAggregateDrop"
          @click="aggregateFileInputRef?.click()"
        >
          <span class="upload-icon">📂</span>
          <p>各作品の <strong>_F1比較.xlsx</strong> を複数ドロップ</p>
          <p class="aggregate-drop-hint">またはクリックして選択</p>
        </div>
        <input ref="aggregateFileInputRef" type="file" accept=".xlsx" multiple class="hidden-file-input" @change="onAggregateFileChange" />
        <p v-if="aggregateError" class="error-msg">{{ aggregateError }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Network } from 'vis-network'
import { DataSet } from 'vis-network/standalone'
import * as XLSX from 'xlsx'

interface Character {
  id: string
  name: string
}

interface Relationship {
  from: string
  to: string
  label: string
}

interface AnalyzeResult {
  title?: string
  characters: Character[]
  relationships: Relationship[]
}

const storyText = ref('')
const isLoading = ref(false)
const isTopCollapsed = ref(false)
const errorMsg = ref('')
const activeTab = ref<'graph' | 'json'>('graph')
const selectedChar = ref<Character | null>(null)
// ファイルアップロード用
const fileInputRef = ref<HTMLInputElement | null>(null)
const aggregateFileInputRef = ref<HTMLInputElement | null>(null)
const showAggregateModal = ref(false)
const isAggregateDragOver = ref(false)
const aggregateError = ref('')
const isDragOver = ref(false)
const showWorkPicker = ref(false)

const closeWorkPicker = () => { showWorkPicker.value = false }
onMounted(() => document.addEventListener('click', closeWorkPicker))
onUnmounted(() => document.removeEventListener('click', closeWorkPicker))
const uploadedFileNames = ref<string[]>([])
const uploadError = ref('')

const receivedChars = ref(0)

// ─── 作品スロット ───
interface WorkSlot {
  id: string
  label: string
  result: AnalyzeResult | null
  fileMetadata: { title: string; subtitleRange: string } | null
  storyText: string
  gtResult: AnalyzeResult | null
}

let _workIdSeq = 0
const newWorkId = () => `w${++_workIdSeq}`

const workSlots = reactive<WorkSlot[]>([])
const activeWorkId = ref<string | null>(null)

const currentWork = computed(() => workSlots.find(w => w.id === activeWorkId.value) ?? null)
const result       = computed(() => currentWork.value?.result    ?? null)
const fileMetadata = computed(() => currentWork.value?.fileMetadata ?? null)
const gtResult     = computed(() => currentWork.value?.gtResult  ?? null)

const gtFileInputRef = ref<HTMLInputElement | null>(null)

function setGtResult(value: AnalyzeResult | null) {
  if (currentWork.value) currentWork.value.gtResult = value
}

function addWorkSlot(slot: WorkSlot) {
  workSlots.push(slot)
  activeWorkId.value = slot.id
  selectedChar.value = null
  storyText.value = slot.storyText
}

function switchWork(id: string) {
  if (currentWork.value) currentWork.value.storyText = storyText.value
  activeWorkId.value = id
  selectedChar.value = null
  storyText.value = currentWork.value?.storyText ?? ''
}

// ─── ネットワーク状態（作品IDごと） ───
interface NetworkSlot {
  instance: Network | null
  nodesDS: DataSet<any> | null
  edgesDS: DataSet<any> | null
  originalEdges: any[]
}
const workNetworkMap = new Map<string, NetworkSlot>()
const workContainerMap = new Map<string, HTMLElement>()

function getNetworkSlot(workId: string): NetworkSlot {
  if (!workNetworkMap.has(workId)) {
    workNetworkMap.set(workId, { instance: null, nodesDS: null, edgesDS: null, originalEdges: [] })
  }
  return workNetworkMap.get(workId)!
}

function registerContainer(workId: string, el: Element | null) {
  if (el instanceof HTMLElement) workContainerMap.set(workId, el)
}

interface ParsedFileData {
  bodyText: string
  title: string
  subtitles: string[]
}

// 列名を柔軟にマッチ
function findCol(headers: string[], keywords: string[]): string | undefined {
  return headers.find(h => keywords.some(k => h.includes(k)))
}

function parseWorkbook(workbook: XLSX.WorkBook): ParsedFileData {
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' })
  if (!rows.length) return { bodyText: '', title: '', subtitles: [] }

  const headers = Object.keys(rows[0])
  const titleCol    = findCol(headers, ['タイトル', 'title', 'Title'])
  const subtitleCol = findCol(headers, ['サブタイトル', 'subtitle', 'Subtitle'])
  const bodyCol     = findCol(headers, ['本文', 'body', 'content', 'Body', 'Content', 'テキスト'])

  const bodyText  = bodyCol  ? rows.map(r => String(r[bodyCol]  ?? '')).filter(Boolean).join('\n') : XLSX.utils.sheet_to_txt(sheet)
  const title     = titleCol    ? String(rows.find(r => r[titleCol])?.[titleCol] ?? '')    : ''
  const subtitles = subtitleCol ? rows.map(r => String(r[subtitleCol] ?? '')).filter(Boolean) : []

  return { bodyText, title, subtitles }
}

function extractFileData(file: File): Promise<ParsedFileData> {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    const reader = new FileReader()

    if (ext === 'csv') {
      reader.onload = (e) => {
        try {
          const workbook = XLSX.read(e.target?.result as string, { type: 'string' })
          resolve(parseWorkbook(workbook))
        } catch {
          reject(new Error(`${file.name}: CSVの解析に失敗しました`))
        }
      }
      reader.onerror = () => reject(new Error(`${file.name}: CSVの読み込みに失敗しました`))
      reader.readAsText(file, 'UTF-8')
    } else if (ext === 'xlsx' || ext === 'xls') {
      reader.onload = (e) => {
        try {
          const workbook = XLSX.read(new Uint8Array(e.target?.result as ArrayBuffer), { type: 'array' })
          resolve(parseWorkbook(workbook))
        } catch {
          reject(new Error(`${file.name}: Excelの解析に失敗しました`))
        }
      }
      reader.onerror = () => reject(new Error(`${file.name}: Excelの読み込みに失敗しました`))
      reader.readAsArrayBuffer(file)
    } else if (ext === 'txt') {
      reader.onload = (e) => resolve({ bodyText: (e.target?.result as string) ?? '', title: '', subtitles: [] })
      reader.onerror = () => reject(new Error(`${file.name}: テキストファイルの読み込みに失敗しました`))
      reader.readAsText(file, 'UTF-8')
    } else {
      reject(new Error(`${file.name}: 対応していない形式です（.xlsx / .xls / .csv / .json / .txt のみ）`))
    }
  })
}

async function handleAllFiles(files: FileList | File[]) {
  uploadError.value = ''
  const errors: string[] = []

  for (const file of Array.from(files)) {
    const ext = file.name.split('.').pop()?.toLowerCase()

    if (ext === 'json') {
      await new Promise<void>((resolve) => {
        const reader = new FileReader()
        reader.onload = (ev) => {
          try {
            const parsed = JSON.parse(ev.target?.result as string) as AnalyzeResult
            if (!Array.isArray(parsed.characters) || !Array.isArray(parsed.relationships)) {
              errors.push(`${file.name}: JSONの形式が正しくありません`)
              resolve()
              return
            }
            const title = parsed.title || file.name.replace(/\.json$/i, '')
            addWorkSlot({
              id: newWorkId(),
              label: title,
              result: parsed,
              fileMetadata: { title, subtitleRange: '' },
              storyText: '',
              gtResult: null,
            })
            uploadedFileNames.value = [...uploadedFileNames.value, file.name]
            activeTab.value = 'graph'
            nextTick(() => { if (currentWork.value?.result) renderNetwork(currentWork.value.result) })
          } catch {
            errors.push(`${file.name}: JSONファイルの解析に失敗しました`)
          }
          resolve()
        }
        reader.onerror = () => { errors.push(`${file.name}: ファイルの読み込みに失敗しました`); resolve() }
        reader.readAsText(file, 'UTF-8')
      })
    } else {
      try {
        const data = await extractFileData(file)
        const subtitles = data.subtitles
        const subtitleRange = subtitles.length === 0 ? '' :
          subtitles.length === 1 ? subtitles[0] :
          `${subtitles[0]}〜${subtitles[subtitles.length - 1]}`
        const fm = (data.title || subtitleRange) ? { title: data.title, subtitleRange } : null
        const label = data.title || file.name.replace(/\.(xlsx?|csv|txt)$/i, '')
        addWorkSlot({
          id: newWorkId(),
          label,
          result: null,
          fileMetadata: fm,
          storyText: data.bodyText,
          gtResult: null,
        })
        uploadedFileNames.value = [...uploadedFileNames.value, file.name]
      } catch (e: unknown) {
        errors.push((e as Error).message)
      }
    }
  }
  if (errors.length) uploadError.value = errors.join(' / ')
}

function onAllFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files?.length) handleAllFiles(files)
  ;(e.target as HTMLInputElement).value = ''
}

function onAllFileDrop(e: DragEvent) {
  isDragOver.value = false
  const files = e.dataTransfer?.files
  if (files?.length) handleAllFiles(files)
}

function onGtFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  ;(e.target as HTMLInputElement).value = ''
  const reader = new FileReader()
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target?.result as string) as AnalyzeResult
      if (!Array.isArray(parsed.characters) || !Array.isArray(parsed.relationships)) {
        uploadError.value = '正解JSONの形式が正しくありません'
        return
      }
      setGtResult(parsed)
      uploadError.value = ''
    } catch {
      uploadError.value = '正解JSONファイルの解析に失敗しました'
    }
  }
  reader.readAsText(file, 'UTF-8')
}

function exportF1Sheet() {
  if (!result.value || !gtResult.value) return

  const title = fileMetadata.value?.title ?? '（タイトルなし）'

  const aiNameMap = Object.fromEntries(result.value.characters.map(c => [c.id, c.name]))
  const gtNameMap = Object.fromEntries(gtResult.value.characters.map(c => [c.id, c.name]))

  const aiRels = result.value.relationships.map(r => ({
    from: aiNameMap[r.from] ?? r.from, to: aiNameMap[r.to] ?? r.to, label: r.label,
  }))
  const gtRels = gtResult.value.relationships.map(r => ({
    from: gtNameMap[r.from] ?? r.from, to: gtNameMap[r.to] ?? r.to, label: r.label,
  }))

  const pairMap = new Map<string, { from: string; to: string; aiLabel: string; gtLabel: string }>()
  for (const r of aiRels) {
    const key = JSON.stringify([r.from, r.to])
    if (!pairMap.has(key)) pairMap.set(key, { from: r.from, to: r.to, aiLabel: r.label, gtLabel: '' })
  }
  for (const r of gtRels) {
    const key = JSON.stringify([r.from, r.to])
    if (pairMap.has(key)) pairMap.get(key)!.gtLabel = r.label
    else pairMap.set(key, { from: r.from, to: r.to, aiLabel: '', gtLabel: r.label })
  }

  const ll = (ai: string, gt: string) => ai && gt ? 'TP' : ai ? 'FP' : 'FN'
  const lo: Record<string, number> = { TP: 0, FP: 1, FN: 2 }
  const pairs = [...pairMap.values()].sort(
    (a, b) => lo[ll(a.aiLabel, a.gtLabel)] - lo[ll(b.aiLabel, b.gtLabel)] || a.from.localeCompare(b.from, 'ja')
  )

  // セル数式ヘルパー
  const fc = (formula: string, cached: string | number): XLSX.CellObject =>
    ({ t: typeof cached === 'number' ? 'n' : 's', v: cached, f: formula } as XLSX.CellObject)
  const dash = (): XLSX.CellObject => ({ t: 's', v: '—' } as XLSX.CellObject)

  // ── Sheet1: 関係性比較（E列=線レベル, F列=意味一致 を数式化） ──
  const s1: (string | XLSX.CellObject)[][] = [
    ['送り手', '受け手', 'AIラベル', '正解ラベル', '線レベル', '意味一致'],
  ]
  pairs.forEach(({ from, to, aiLabel, gtLabel }, i) => {
    const r = i + 2  // ヘッダが1行目なのでデータは2行目〜
    s1.push([
      from, to, aiLabel, gtLabel,
      fc(`IF(AND(C${r}<>"",D${r}<>""),"TP",IF(C${r}<>"","FP","FN"))`, ll(aiLabel, gtLabel)),
      fc(`IF(OR(C${r}="",D${r}=""),"×",IF(C${r}=D${r},"○","×"))`,
        aiLabel && gtLabel && aiLabel === gtLabel ? '○' : '×'),
    ])
  })

  // ── Sheet2: 評価サマリ（Sheet1を参照する数式 + D列に平易な説明） ──
  const S = "'関係性比較'"
  const s2: (string | XLSX.CellObject)[][] = [
    ['指標',            '線レベル',                                                     '意味レベル',                                                                                            '説明'],
    ['TP',              fc(`COUNTIF(${S}!E2:E1048576,"TP")`,           0),  fc(`COUNTIF(${S}!F2:F1048576,"○")`,                                          0),  'AIが正しく抽出できた関係性の数'],
    ['FP',              fc(`COUNTIF(${S}!E2:E1048576,"FP")`,           0),  fc(`COUNTIFS(${S}!E2:E1048576,"TP",${S}!F2:F1048576,"×")`,                   0),  '線レベル：余剰検出　意味レベル：線TPのうちラベル誤り'],
    ['FN',              fc(`COUNTIF(${S}!E2:E1048576,"FN")`,           0),  fc(`COUNTIFS(${S}!E2:E1048576,"TP",${S}!F2:F1048576,"×")`,                   0),  '線レベル：見逃し　意味レベル：線TPのうちラベル誤り'],
    ['適合率 (%)',       fc(`IFERROR(B2/(B2+B3)*100,0)`,                0),  dash(),                                                                                                              'TP÷(TP+FP)×100　AIの抽出結果のうち正解だった割合'],
    ['再現率 (%)',       fc(`IFERROR(B2/(B2+B4)*100,0)`,                0),  dash(),                                                                                                              'TP÷(TP+FN)×100　正解全体をどれだけ漏れなく見つけられたか'],
    ['F1 (%)',           fc(`IFERROR(2*B5*B6/(B5+B6),0)`,               0),  dash(),                                                                                                              '適合率と再現率の調和平均。総合スコア'],
    ['ラベル一致率（適合率） (%)', dash(),                                              fc(`IFERROR(C2/COUNTIF(${S}!E2:E1048576,"TP")*100,0)`,                       0),  '線レベルTPのうちラベルまで正解と一致した割合'],
    ['AI関係性数',       dash(),                                              fc(`COUNTIF(${S}!C2:C1048576,"<>")`,                                          0),  'AIが抽出した関係性の総数'],
    ['正解関係性数',     dash(),                                              fc(`COUNTIF(${S}!D2:D1048576,"<>")`,                                          0),  '正解データに含まれる関係性の総数'],
  ]

  // ── Sheet3: 評価定義（静的な説明シート） ──
  const s3: string[][] = [
    ['項目', '内容'],
    ['【線レベル】とは',    'AIが「A→B」という有向エッジを引いたかどうかだけを評価する。ラベル（関係の種類）は問わない。'],
    ['【意味レベル】とは',  '線レベルTPの辺（AIと正解の両方に存在する辺）に限定して、ラベルが正解と一致するかを評価する。辺自体を見逃したケースは線レベルのみでカウントし、意味レベルには含めない。'],
    ['【ラベル一致率（適合率）】とは', '線レベルTPのうち、ラベルまで正解と一致した辺の割合。= 意味TP ÷ 線TP件数 × 100'],
    ['', ''],
    ['TP（正解一致）',      '【線】AIと正解の両方に同じ辺が存在する　【意味】さらにラベルも一致'],
    ['FP（余剰・ラベル誤）', '【線】AIが抽出したが正解にない辺　【意味】線TPのうちラベルが不一致の辺'],
    ['FN（見逃し・ラベル誤）','【線】正解にあるがAIが見逃した辺　【意味】線TPのうちラベルが不一致の辺'],
    ['', ''],
    ['適合率（Precision）', '【線レベルのみ】TP ÷ (TP + FP) × 100'],
    ['再現率（Recall）',    '【線レベルのみ】TP ÷ (TP + FN) × 100'],
    ['F1スコア',            '【線レベルのみ】2 × 適合率 × 再現率 ÷ (適合率 + 再現率)'],
    ['', ''],
    ['【ラベル不一致の扱い】', 'AIが「A→B: Friend Of」と抽出し、正解が「A→B: Enemy Of」の場合：'],
    ['',                    '　線レベル → TP（エッジの有無は正しい）'],
    ['',                    '　意味レベル → FP かつ FN（同じ辺を両側から見ているため常に FP＝FN）'],
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1), '関係性比較')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s2), '評価サマリ')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s3), '評価定義')
  XLSX.writeFile(wb, `${title}_F1比較.xlsx`.replace(/[\\/:*?"<>|]/g, '_'))
}

function downloadJson() {
  if (!result.value) return
  const title = fileMetadata.value?.title
  const baseName = title
    ? title.replace(/[\\/:*?"<>|]/g, '_').trim() + '_relation'
    : 'characters'
  const payload = { title: title ?? '', ...result.value }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${baseName}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function exportExperimentData() {
  if (!result.value) return

  const title   = fileMetadata.value?.title ?? '（タイトルなし）'
  const charMap = Object.fromEntries(result.value.characters.map(c => [c.id, c.name]))

  const rows = result.value.relationships.map(rel => ({
    作品名: title,
    関係性: `${charMap[rel.from] ?? rel.from} → ${charMap[rel.to] ?? rel.to}`,
    ラベル: rel.label,
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '実験データ')
  XLSX.writeFile(wb, `${title}_実験データ.xlsx`.replace(/[\\/:*?"<>|]/g, '_'))
}

function onAggregateDrop(e: DragEvent) {
  isAggregateDragOver.value = false
  const files = e.dataTransfer?.files
  if (files?.length) { exportAggregateSummary(files); showAggregateModal.value = false }
}

function onAggregateFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files?.length) { exportAggregateSummary(files); showAggregateModal.value = false }
  ;(e.target as HTMLInputElement).value = ''
}

async function exportAggregateSummary(files: FileList) {
  const summaryRows: (string | number)[][] = []

  for (const file of Array.from(files)) {
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
      const sheet = wb.Sheets['関係性比較']
      if (!sheet) continue

      const data = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 })

      let lineTP = 0, lineFP = 0, lineFN = 0, semTP = 0, semFP = 0
      for (const row of (data as (string | number)[][]).slice(1)) {
        const lineLevel = row[4]
        const semLevel  = row[5]
        if (lineLevel === 'TP') lineTP++
        else if (lineLevel === 'FP') lineFP++
        else if (lineLevel === 'FN') lineFN++
        if (semLevel === '○') semTP++
        if (lineLevel === 'TP' && semLevel === '×') semFP++
      }

      const lineP  = lineTP + lineFP > 0 ? lineTP / (lineTP + lineFP) * 100 : 0
      const lineR  = lineTP + lineFN > 0 ? lineTP / (lineTP + lineFN) * 100 : 0
      const lineF1 = lineP + lineR > 0   ? 2 * lineP * lineR / (lineP + lineR) : 0
      const labelAcc = lineTP > 0        ? semTP / lineTP * 100 : 0

      const title = file.name.replace(/_F1比較\.xlsx$/i, '').replace(/\.xlsx$/i, '')
      summaryRows.push([title, lineTP, lineFP, lineFN,
        +lineP.toFixed(1), +lineR.toFixed(1), +lineF1.toFixed(1),
        semTP, semFP, +labelAcc.toFixed(1)])
    } catch {
      // 読み込めないファイルはスキップ
    }
  }

  if (!summaryRows.length) return

  const header = ['作品名', '線TP', '線FP', '線FN', '線適合率(%)', '線再現率(%)', '線F1(%)', '意味TP', '意味FP(ラベル誤)', 'ラベル一致率(適合率)(%)']
  const ws = XLSX.utils.aoa_to_sheet([header, ...summaryRows])
  const wbOut = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wbOut, ws, '評価まとめ')
  XLSX.writeFile(wbOut, '複数作品_F1比較まとめ.xlsx')
}

const displayedRelationships = computed(() => {
  if (!result.value) return []
  const charMap = Object.fromEntries(result.value.characters.map(c => [c.id, c.name]))
  return [...result.value.relationships]
    .sort((a, b) => (charMap[a.from] ?? a.from).localeCompare(charMap[b.from] ?? b.from, 'ja'))
    .map(r => ({ fromId: r.from, toId: r.to, fromName: charMap[r.from] ?? r.from, toName: charMap[r.to] ?? r.to, label: r.label }))
})

const outgoingRelationships = computed(() => {
  if (!selectedChar.value || !result.value) return []
  const charMap = Object.fromEntries(result.value.characters.map(c => [c.id, c.name]))
  return result.value.relationships
    .filter(r => r.from === selectedChar.value!.id)
    .map(r => ({ toId: r.to, toName: charMap[r.to] ?? r.to, label: r.label }))
})

const incomingRelationships = computed(() => {
  if (!selectedChar.value || !result.value) return []
  const charMap = Object.fromEntries(result.value.characters.map(c => [c.id, c.name]))
  return result.value.relationships
    .filter(r => r.to === selectedChar.value!.id)
    .map(r => ({ fromId: r.from, fromName: charMap[r.from] ?? r.from, label: r.label }))
})

async function analyze() {
  isLoading.value = true
  receivedChars.value = 0
  errorMsg.value = ''
  selectedChar.value = null

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: storyText.value }),
    })

    if (!response.ok || !response.body) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message ?? `HTTP ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // SSE は \n\n でメッセージを区切る
      const messages = buffer.split('\n\n')
      buffer = messages.pop() ?? ''

      for (const message of messages) {
        const dataLine = message.split('\n').find(l => l.startsWith('data: '))
        if (!dataLine) continue

        const json = JSON.parse(dataLine.slice(6))

        if (json.type === 'progress') {
          receivedChars.value = json.chars
        } else if (json.type === 'done') {
          const analyzed: AnalyzeResult = json.result as AnalyzeResult
          const work = currentWork.value
          if (work && !work.result) {
            work.result = analyzed
            if (analyzed.title) work.label = analyzed.title
          } else {
            addWorkSlot({
              id: newWorkId(),
              label: analyzed.title ?? fileMetadata.value?.title ?? '解析結果',
              result: analyzed,
              fileMetadata: fileMetadata.value,
              storyText: storyText.value,
              gtResult: null,
            })
          }
          activeTab.value = 'graph'
          await nextTick()
          if (currentWork.value?.result) renderNetwork(currentWork.value.result)
        } else if (json.type === 'error') {
          throw new Error(json.message)
        }
      }
    }
  } catch (err: unknown) {
    const e = err as { message?: string }
    errorMsg.value = e?.message ?? '解析中にエラーが発生しました。'
  } finally {
    isLoading.value = false
  }
}

function bringConnectedEdgesToFront(nodeId: string | number) {
  const workId = currentWork.value?.id
  if (!workId) return
  const ns = getNetworkSlot(workId)
  if (!ns.edgesDS || !ns.instance) return
  const connectedIds = new Set(ns.instance.getConnectedEdges(nodeId) as string[])

  const nonConnected = ns.originalEdges
    .filter((e: any) => !connectedIds.has(e.id))
    .map((e: any) => ({ ...e, color: { color: '#2d3a4a' }, width: 1.5 }))

  const connected = ns.originalEdges
    .filter((e: any) => connectedIds.has(e.id))
    .map((e: any) => ({ ...e, color: { color: '#7dd3fc', highlight: '#7dd3fc' }, width: 3 }))

  ns.edgesDS.clear()
  ns.edgesDS.add([...nonConnected, ...connected])
}

function resetEdgeStyles() {
  const workId = currentWork.value?.id
  if (!workId) return
  const ns = getNetworkSlot(workId)
  if (!ns.edgesDS) return
  ns.edgesDS.clear()
  ns.edgesDS.add([...ns.originalEdges])
}

function renderNetwork(data: AnalyzeResult) {
  const workId = currentWork.value?.id
  if (!workId) return
  const container = workContainerMap.get(workId)
  if (!container) return

  const ns = getNetworkSlot(workId)
  if (ns.instance) {
    ns.instance.destroy()
    ns.instance = null
  }

  ns.nodesDS = new DataSet<any>(
    data.characters.map((c) => ({
      id: c.id,
      label: c.name,
      color: { background: '#4f8ef7', border: '#1a56c4', highlight: { background: '#4f8ef7', border: '#fff' } },
      font: { color: '#fff', size: 18 },
      shape: 'ellipse',
      size: 55,
      borderWidth: 2,
      shadow: { enabled: true, size: 8, x: 3, y: 3 },
      avoidOverlap: 1,
    })),
  )

  ns.originalEdges = data.relationships.map((r, i) => ({
    id: `e${i}`,
    from: r.from,
    to: r.to,
    label: r.label,
    arrows: 'to',
    font: { size: 16, color: '#ffffff', align: 'middle', background: '#1e3a5f', strokeWidth: 2, strokeColor: '#1e3a5f' },
    color: { color: '#64748b', highlight: '#7dd3fc' },
    width: 2,
    smooth: { enabled: true, type: 'curvedCW', roundness: 0.2 },
  }))
  ns.edgesDS = new DataSet(ns.originalEdges)

  ns.instance = new Network(
    container,
    { nodes: ns.nodesDS, edges: ns.edgesDS },
    {
      physics: {
        solver: 'forceAtlas2Based',
        forceAtlas2Based: {
          gravitationalConstant: -250,
          centralGravity: 0.003,
          springLength: 600,
          springConstant: 0.015,
        },
        stabilization: { iterations: Math.min(200, data.characters.length * 10) },
      },
      interaction: { hover: true, zoomView: true },
      nodes: { margin: { top: 12, right: 12, bottom: 12, left: 12 } },
    },
  )

  ns.instance.on('click', (params) => {
    if (params.nodes.length > 0) {
      const nodeId = params.nodes[0]
      selectedChar.value = data.characters.find((c) => c.id === nodeId) ?? null
      bringConnectedEdgesToFront(nodeId)
    } else {
      selectedChar.value = null
      resetEdgeStyles()
    }
  })

  ns.instance.once('stabilizationIterationsDone', () => {
    ns.instance?.fit({ animation: { duration: 600, easingFunction: 'easeInOutQuad' } })
  })
}
</script>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif;
  background: #0f1117;
  color: #e2e8f0;
  height: 100vh;
  overflow: hidden;
}

.layout {
  display: flex;
  height: 100vh;
}

/* ─── 左ペイン ─── */
.main-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: clamp(8px, 2vw, 16px);
  gap: clamp(6px, 1.5vh, 10px);
  overflow: hidden;
}

.app-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1 1 160px;
}
.experiment-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  align-self: center;
}
.participant-input {
  width: 130px;
  padding: 5px 10px;
  background: #1e2535;
  border: 1px solid #334155;
  border-radius: 6px;
  color: #e2e8f0;
  font-size: 0.85rem;
}
.participant-input::placeholder { color: #475569; }
.participant-input:focus { outline: none; border-color: #7dd3fc; }
.export-btn {
  padding: 5px 12px;
  background: #166534;
  border: 1px solid #15803d;
  border-radius: 6px;
  color: #fff;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.export-btn:hover { background: #15803d; }
.aggregate-btn { background: #1e3a5f; border-color: #2d5a9f; }
.aggregate-btn:hover { background: #1e4a7f; }

/* まとめ比較モーダル */
.aggregate-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.aggregate-modal {
  background: #1e2535;
  border: 1px solid #334155;
  border-radius: 12px;
  padding: 24px;
  width: clamp(320px, 50vw, 520px);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.aggregate-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 1rem;
  font-weight: 700;
  color: #7dd3fc;
}
.aggregate-modal-close {
  background: none;
  border: none;
  color: #64748b;
  font-size: 1rem;
  cursor: pointer;
  transition: color 0.2s;
}
.aggregate-modal-close:hover { color: #f87171; }
.aggregate-drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 20px;
  border: 2px dashed #334155;
  border-radius: 10px;
  cursor: pointer;
  text-align: center;
  transition: border-color 0.2s, background 0.2s;
  color: #94a3b8;
  font-size: 0.9rem;
}
.aggregate-drop-zone:hover,
.aggregate-drop-zone.drag-over {
  border-color: #4f8ef7;
  background: #1a2540;
  color: #e2e8f0;
}
.aggregate-drop-zone .upload-icon { font-size: 2rem; }
.aggregate-drop-zone strong { color: #7dd3fc; }
.aggregate-drop-hint { font-size: 0.78rem; color: #475569; }

.app-header h1 {
  font-size: 1.2rem;
  font-weight: 700;
  color: #7dd3fc;
}

.file-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 4px;
  flex-wrap: wrap;
}
.file-meta-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: #e2e8f0;
}
.file-meta-subtitle {
  font-size: 0.82rem;
  color: #94a3b8;
}

/* 折り畳み上部パネル */
.top-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
  max-height: 600px;
  transition: max-height 0.35s ease, opacity 0.25s ease;
  opacity: 1;
}
.top-panel.collapsed {
  max-height: 0;
  opacity: 0;
  pointer-events: none;
}

/* 折り畳みハンドル */
.collapse-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 18px;
  background: #1a1f2e;
  border: 1px solid #334155;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.2s, border-color 0.2s;
  padding: 0;
}
.collapse-handle:hover {
  background: #1e2d45;
  border-color: #4f8ef7;
}
.collapse-chevron {
  font-size: 0.6rem;
  color: #475569;
  transition: transform 0.3s ease, color 0.2s;
  line-height: 1;
}
.collapse-handle:hover .collapse-chevron { color: #7dd3fc; }
.collapse-chevron.up {
  transform: rotate(180deg);
}

.input-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.upload-zone {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: #1e2130;
  border: 2px dashed #334155;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  user-select: none;
}
.upload-zone:hover, .upload-zone.drag-over {
  border-color: #4f8ef7;
  background: #1a2540;
}
.upload-icon { font-size: 1.2rem; flex-shrink: 0; }
.upload-text { font-size: 0.82rem; color: #64748b; }
.upload-filename {
  margin-left: auto;
  font-size: 0.8rem;
  color: #7dd3fc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}
.hidden-file-input { display: none; }

.action-row {
  display: flex;
  justify-content: flex-end;
}

.story-input {
  width: 100%;
  padding: 10px 12px;
  background: #1e2130;
  border: 1px solid #334155;
  border-radius: 8px;
  color: #e2e8f0;
  font-size: 0.9rem;
  resize: vertical;
}
.story-input:focus { outline: none; border-color: #4f8ef7; }

.analyze-btn {
  align-self: flex-end;
  padding: 8px 24px;
  background: #4f8ef7;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}
.analyze-btn:hover:not(:disabled) { background: #2563eb; }
.analyze-btn:disabled { background: #334155; cursor: not-allowed; }

.error-msg { color: #f87171; font-size: 0.85rem; }

/* タブ */
.tab-bar {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid #334155;
  padding-bottom: 4px;
  align-items: center;
  flex-wrap: nowrap;
  flex-shrink: 0;
  min-width: 0;
}
.tab-btn {
  padding: 6px 12px;
  background: none;
  border: none;
  border-radius: 6px 6px 0 0;
  color: #94a3b8;
  cursor: pointer;
  font-size: clamp(0.78rem, 1.8vw, 0.88rem);
  white-space: nowrap;
  flex-shrink: 0;
  transition: color 0.2s, background 0.2s;
}
.tab-btn.active { color: #7dd3fc; background: #1e2130; }
.tab-btn:hover:not(.active) { color: #e2e8f0; }

.download-btn {
  padding: 4px 8px;
  background: #1e3a5f;
  border: 1px solid #334155;
  border-radius: 6px;
  color: #7dd3fc;
  cursor: pointer;
  font-size: clamp(0.7rem, 1.6vw, 0.78rem);
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.2s;
}
.download-btn:hover { background: #1e4a7f; }
.gt-load-btn { background: #1e2535; border-color: #475569; color: #94a3b8; }
.gt-load-btn:hover { background: #263045; color: #e2e8f0; }
.f1-export-btn { background: #166534; border-color: #15803d; color: #86efac; }
.f1-export-btn:hover { background: #15803d; }
.gt-clear-btn {
  padding: 4px 7px;
  background: none;
  border: 1px solid #334155;
  border-radius: 6px;
  color: #64748b;
  cursor: pointer;
  font-size: 0.72rem;
  flex-shrink: 0;
  transition: color 0.2s, border-color 0.2s;
}
.gt-clear-btn:hover { color: #f87171; border-color: #f87171; }

/* tab-bar 右側グループ */
.tab-bar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  min-width: 0;
  flex-shrink: 1;
}

/* 作品切り替えピッカー */
.work-picker-wrapper {
  position: relative;
  min-width: 0;
  flex-shrink: 1;
}
.work-picker-btn {
  padding: 4px 10px;
  background: #1e2535;
  border: 1px solid #334155;
  border-radius: 6px;
  color: #94a3b8;
  cursor: pointer;
  font-size: clamp(0.72rem, 1.6vw, 0.82rem);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: clamp(90px, 16vw, 200px);
  display: block;
  transition: color 0.2s, background 0.2s;
}
.work-picker-btn:hover { color: #e2e8f0; background: #263045; }
.work-picker-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 160px;
  background: #1e2535;
  border: 1px solid #334155;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  z-index: 100;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.work-picker-item {
  padding: 8px 14px;
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 0.85rem;
  text-align: left;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
.work-picker-item:hover { background: #263045; color: #e2e8f0; }
.work-picker-item.active { color: #7dd3fc; font-weight: 600; }

/* 未解析スロット */
.no-result-pane {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #475569;
  font-size: 0.9rem;
}

/* 相関図 */
.network-container {
  flex: 1;
  background: #1a1f2e;
  border-radius: 10px;
  border: 1px solid #334155;
  overflow: hidden;
}

/* JSONビュー */
.json-view {
  flex: 1;
  overflow: auto;
  background: #1e2130;
  border-radius: 8px;
  border: 1px solid #334155;
  padding: 12px;
}
.json-view pre {
  font-size: 0.8rem;
  color: #a5f3fc;
  white-space: pre-wrap;
}

/* ─── 右サイドバー ─── */

.sidebar {
  width: clamp(200px, 28%, 300px);
  min-width: 0;
  background: #131720;
  border-left: 1px solid #1e2d45;
  padding: 14px 10px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex-shrink: 0;
}

.sidebar h2 {
  font-size: clamp(0.78rem, 1.8vw, 0.95rem);
  font-weight: 700;
  color: #7dd3fc;
  letter-spacing: 0.05em;
  border-bottom: 1px solid #1e2d45;
  padding-bottom: 8px;
  white-space: nowrap;
}

/* フィルタバッジ */
.interaction-filter-badge {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  background: #1e3a5f;
  border: 1px solid #2d5a9f;
  border-radius: 6px;
  padding: 5px 8px;
  font-size: clamp(0.7rem, 1.6vw, 0.8rem);
  color: #7dd3fc;
  min-width: 0;
}
.clear-filter-btn {
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 0.78rem;
  padding: 0 2px;
  flex-shrink: 0;
  transition: color 0.2s;
}
.clear-filter-btn:hover { color: #f87171; }

.sidebar-hint {
  font-size: clamp(0.75rem, 1.6vw, 0.85rem);
  color: #475569;
  line-height: 1.7;
}

/* カード型詳細セクション */
.detail-card {
  background: #1e2535;
  border: 1px solid #263045;
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-card-label {
  font-size: clamp(0.62rem, 1.4vw, 0.7rem);
  font-weight: 700;
  color: #7dd3fc;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.detail-card-body {
  font-size: clamp(0.78rem, 1.8vw, 0.875rem);
  color: #cbd5e1;
  line-height: 1.65;
}

.detail-card-body.muted { color: #475569; font-style: italic; }

/* 相互作用リスト */
.interaction-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.interaction-item {
  padding-left: 12px;
  position: relative;
  display: flex;
  flex-direction: column;
}
.interaction-item::before {
  content: '▸';
  position: absolute;
  left: 0;
  color: #4f8ef7;
  font-size: 0.7rem;
  top: 3px;
}
.interaction-chars {
  font-size: clamp(0.75rem, 1.8vw, 0.85rem);
  font-weight: 600;
  color: #e2e8f0;
}
.interaction-label {
  font-size: clamp(0.7rem, 1.6vw, 0.8rem);
  color: #94a3b8;
  margin-top: 2px;
}
</style>
