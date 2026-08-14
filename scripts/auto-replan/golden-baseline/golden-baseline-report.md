# 自动排柜基础物理口径黄金基准 V1.0

## 冻结结论

- 规则来源：`user-confirmed-business-rule`。
- 商品允许水平旋转90°，长宽可互换，高度不翻转。
- 立柜第1–5层不允许上下堆叠，`stackCount=1`。
- 立柜第6层只作存储，不生成销售候选。
- 卧柜允许上下堆叠，按真实有效高度计算 `floor(cabinetHeight / SKU.height)`。
- 冰淇淋柜允许上下堆叠，按真实有效高度计算。
- 冰淇淋SKU只能进入冰淇淋柜，普通冻品不得进入冰淇淋柜。
- 柜4没有任何特殊规则。

## 数据来源

SKU只来自 `data/app-data.json.productPool`。尺寸字段为 `length/width/height`，按mm使用；箱规字段为 `carton`，含义为每箱件数；单件体积字段为 `volume`，当前按L使用。

柜体配置来自 `data/app-data.json.cabinets`。和县黄金柜段通过“门店 + 柜号 + 具体位置”唯一匹配 `data/user-confirmed-physical-dimensions.json`，采用人工确认真实内部有效尺寸，单位mm。

本轮没有向 `app-data.json` 批量添加 `allowedOrientations/allowStack/allowVerticalStack`。正式物理规则集中保存在 `scripts/auto-replan/physical-business-rules.mjs`。

## 正式计算公式

方向1：

- `faceWidth = SKU.length`
- `orientedDepth = SKU.width`
- `orientedHeight = SKU.height`

方向2：

- `faceWidth = SKU.width`
- `orientedDepth = SKU.length`
- `orientedHeight = SKU.height`

两个方向均必须满足：

- `faceWidth <= cabinetLength`
- `orientedDepth <= cabinetDepth`
- `orientedHeight <= cabinetHeight`

容量公式：

- `depthCount = floor(cabinetDepth / orientedDepth)`
- 立柜销售层：`stackCount = 1`
- 卧柜、冰淇淋柜：`stackCount = floor(cabinetHeight / orientedHeight)`
- `perCol = depthCount × stackCount`

库存公式：

- `fullDisplay = displayCols × perCol`
- `triggerInventory = ceil(fullDisplay × 10%)`
- `triggerAvailable = fullDisplay - triggerInventory`
- `externalUnits = max(0, cartonQty - triggerAvailable)`
- `staticExternalL = externalUnits × unitVolumeL`
- `avgExternalL = staticExternalL / 2`
- `directCase = externalUnits === 0`

## 黄金样本

- 20个真实SKU，覆盖大小尺寸、大小箱规、高低销量、A/B/C/D/未评级、冰淇淋与普通冻品、历史1/2/3/4列以上、较高外储和接近整箱样本。
- 12个真实柜段：立柜销售层5个、立柜第6层1个、卧柜4个、冰淇淋柜2个。
- 每个SKU都固定两个水平方向候选，并分别固定 `orientation/faceWidth/orientedDepth/orientedHeight/depthCount/stackCount/perCol` 以及1、2、3列库存结果。
- 固定expected全部写在 `golden-baseline.json`，测试运行时不会调用生产函数生成expected。

## 五个完整人工容量计算

### 1. 宏宝来俄式大脆筒 — 冰淇淋柜1900分区1

SKU为320×100×45mm，柜段为1352×697×447mm，箱规20，单件1.44L。

方向1：正面320、纵深100、高45；`depthCount=floor(697/100)=6`；`stackCount=floor(447/45)=9`；`perCol=6×9=54`。1列满陈54，触发库存6，可收货48，外储0，直接整箱。

方向2：正面100、纵深320、高45；`depthCount=floor(697/320)=2`；`stackCount=9`；`perCol=18`。1列满陈18，触发库存2，可收货16，外储4件，静态外储`4×1.44=5.76L`。

### 2. 冻榴莲 — 卧柜2500分区1

SKU为270×220×70mm，柜段为1988×697×460mm，箱规30，单件4.158L。

方向1：正面270、纵深220、高70；`depthCount=3`；`stackCount=floor(460/70)=6`；`perCol=18`。1列可收货16，外储14件，静态外储58.212L。

方向2：正面220、纵深270、高70；`depthCount=2`；`stackCount=6`；`perCol=12`。1列可收货10，外储20件，静态外储83.16L。

### 3. 番茄肉酱意大利面 — 立柜3m第1层

SKU为220×130×40mm，柜段为710×534×250mm。立柜固定不堆叠。

方向1：正面220、纵深130；`depthCount=floor(534/130)=4`；`stackCount=1`；`perCol=4`。

方向2：正面130、纵深220；`depthCount=floor(534/220)=2`；`stackCount=1`；`perCol=2`。即使柜高250可容纳多个40mm，立柜仍不得把stackCount算成6。

### 4. 宏宝莱老冰棍 — 冰淇淋柜1900分区1

SKU为200×55×30mm，柜段为1352×697×447mm。

方向1：正面200、纵深55；`depthCount=12`；`stackCount=floor(447/30)=14`；`perCol=168`。

方向2：正面55、纵深200；`depthCount=3`；`stackCount=14`；`perCol=42`。两个方向都合法并保留为物理候选。

### 5. 鲜奶馒头 — 立柜3m第1层

SKU为300×260×50mm，柜段为710×534×250mm，箱规24，单件3.9L。

方向1：正面300、纵深260；`depthCount=2`；`stackCount=1`；`perCol=2`。3列满陈6，触发1，可收货5，外储19件，静态外储74.1L。

方向2：正面260、纵深300；`depthCount=1`；`stackCount=1`；`perCol=1`。3列满陈3，触发1，可收货2，外储22件，静态外储85.8L。

## 黄金测试结果

- 原597条断言：597通过，0失败。
- 新增双方向物理、物理适配及容量断言：1220通过，0失败。
- 总计：1817通过，0失败，通过率100%。
- 耗时：69.59ms。
- 没有运行整店FAST、30店FULL或任何排柜优化。

## 已消除的未确认项

以下字段均已有固定黄金expected，不再属于未确认项：

- orientation：否
- faceWidth：否
- orientedDepth：否
- orientedHeight：否
- depthCount：否
- stackCount：否
- perCol：否

## 仍保留但本轮不处理的其他数据问题

- `businessPriority` 在当前产品池缺失。
- 冰淇淋标识仍依赖品类/名称文本识别。
- `volume` 没有独立字段级单位元数据。
- 条码缺失时仍存在SKU唯一键回退逻辑。

这些问题不影响本轮已确认物理规则的黄金测试，且本轮没有扩大修改范围。

## 范围确认

- 修改生产排柜优化算法：否。
- 修改SKU选择、外储优化、754L或品类集中逻辑：否。
- 修改正式产品池或 `app-data.json`：否。
- 修改生命周期：否。
- 修改原小程序UI：否。
- 运行整店排柜：否。
- commit：否。
- push：否。
