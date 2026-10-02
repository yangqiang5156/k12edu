import type { ContentItem, RewardDefinition } from './types';
import { ensureContentAge } from './content-library';
import curriculum from './data/curriculum.json';
import characterWords from './data/character-words.json';
import schoolPoems from './data/school-poems.json';

export const BUILTIN_CONTENT_VERSION = '2026.09.27-1';

interface SchoolPoem {
  title: string;
  author: string;
  dynasty: string;
  body: string;
  grade: number;
}

const poems = schoolPoems as SchoolPoem[];

function poemAgeRange(grade: number, legacyPoem: boolean): { ageMin: number; ageMax: number } {
  if (legacyPoem) return { ageMin: 4, ageMax: 12 };
  if (grade <= 2) return { ageMin: 5, ageMax: 12 };
  if (grade <= 4) return { ageMin: 7, ageMax: 12 };
  if (grade <= 6) return { ageMin: 9, ageMax: 12 };
  return { ageMin: 11, ageMax: 12 };
}

const characters = [
  ['人', 'rén', '大人'], ['口', 'kǒu', '开口'], ['手', 'shǒu', '小手'], ['大', 'dà', '大小'],
  ['小', 'xiǎo', '小鸟'], ['上', 'shàng', '上面'], ['下', 'xià', '下面'], ['山', 'shān', '高山'],
  ['水', 'shuǐ', '喝水'], ['火', 'huǒ', '火苗'], ['日', 'rì', '日光'], ['月', 'yuè', '月亮'],
  ['田', 'tián', '田地'], ['木', 'mù', '木头'], ['禾', 'hé', '禾苗'], ['土', 'tǔ', '泥土'],
  ['一', 'yī', '一个'], ['二', 'èr', '二月'], ['三', 'sān', '三个'], ['四', 'sì', '四季'],
  ['五', 'wǔ', '五颗'], ['六', 'liù', '六只'], ['七', 'qī', '七彩'], ['八', 'bā', '八方'],
  ['九', 'jiǔ', '九月'], ['十', 'shí', '十个'], ['天', 'tiān', '天空'], ['云', 'yún', '白云'],
  ['雨', 'yǔ', '下雨'], ['风', 'fēng', '大风'], ['花', 'huā', '花朵'], ['草', 'cǎo', '小草'],
  ['虫', 'chóng', '昆虫'], ['鱼', 'yú', '小鱼'], ['鸟', 'niǎo', '飞鸟'], ['马', 'mǎ', '小马'],
  ['牛', 'niú', '黄牛'], ['羊', 'yáng', '山羊'], ['米', 'mǐ', '大米'], ['果', 'guǒ', '水果']
];

const characterDetails = new Map(characters.map(([title, subtitle, body]) => [title, { subtitle, body }]));
const allCharacterTitles = Array.from(new Set(Array.from(curriculum.characterCorpus)));
const allCharacters = allCharacterTitles.map((title) => ({
  title,
  subtitle: characterDetails.get(title)?.subtitle ?? '幼小衔接常用字',
  body: characterDetails.get(title)?.body ?? `认识“${title}”字，在生活中找一找它。`,
  exampleWord: (characterWords as Record<string, string>)[title]
}));

const englishWords: Array<[string, string]> = [
  ['apple', '苹果'], ['banana', '香蕉'], ['orange', '橙子'], ['grape', '葡萄'], ['pear', '梨'],
  ['cat', '猫'], ['dog', '狗'], ['bird', '鸟'], ['fish', '鱼'], ['rabbit', '兔子'],
  ['red', '红色'], ['blue', '蓝色'], ['yellow', '黄色'], ['green', '绿色'], ['purple', '紫色'],
  ['one', '一'], ['two', '二'], ['three', '三'], ['four', '四'], ['five', '五'],
  ['head', '头'], ['eye', '眼睛'], ['nose', '鼻子'], ['mouth', '嘴巴'], ['hand', '手'],
  ['sun', '太阳'], ['moon', '月亮'], ['star', '星星'], ['cloud', '云'], ['rain', '雨'],
  ['car', '汽车'], ['bus', '公交车'], ['train', '火车'], ['boat', '小船'], ['bike', '自行车'],
  ['happy', '开心'], ['sad', '难过'], ['big', '大的'], ['small', '小的'], ['fast', '快的'],
  ['mom', '妈妈'], ['dad', '爸爸'], ['baby', '宝宝'], ['friend', '朋友'], ['family', '家庭'],
  ['book', '书'], ['ball', '球'], ['cup', '杯子'], ['bed', '床'], ['door', '门']
];

const extraEnglishWords: Array<[string, string, string]> = [
  ['ant', '蚂蚁', '动物'], ['bear', '熊', '动物'], ['bee', '蜜蜂', '动物'], ['butterfly', '蝴蝶', '动物'], ['chicken', '小鸡', '动物'], ['cow', '奶牛', '动物'], ['duck', '鸭子', '动物'], ['elephant', '大象', '动物'], ['fox', '狐狸', '动物'], ['frog', '青蛙', '动物'], ['giraffe', '长颈鹿', '动物'], ['horse', '马', '动物'], ['lion', '狮子', '动物'], ['monkey', '猴子', '动物'], ['mouse', '老鼠', '动物'], ['panda', '熊猫', '动物'], ['pig', '猪', '动物'], ['sheep', '绵羊', '动物'], ['snake', '蛇', '动物'], ['tiger', '老虎', '动物'], ['turtle', '乌龟', '动物'], ['zebra', '斑马', '动物'],
  ['peach', '桃子', '食物'], ['watermelon', '西瓜', '食物'], ['strawberry', '草莓', '食物'], ['lemon', '柠檬', '食物'], ['mango', '芒果', '食物'], ['pineapple', '菠萝', '食物'], ['tomato', '西红柿', '食物'], ['potato', '土豆', '食物'], ['carrot', '胡萝卜', '食物'], ['corn', '玉米', '食物'], ['rice', '米饭', '食物'], ['noodle', '面条', '食物'], ['bread', '面包', '食物'], ['cake', '蛋糕', '食物'], ['cookie', '饼干', '食物'], ['candy', '糖果', '食物'], ['egg', '鸡蛋', '食物'], ['milk', '牛奶', '食物'], ['water', '水', '食物'], ['juice', '果汁', '食物'], ['soup', '汤', '食物'], ['cheese', '奶酪', '食物'],
  ['black', '黑色', '颜色'], ['white', '白色', '颜色'], ['pink', '粉色', '颜色'], ['brown', '棕色', '颜色'], ['gray', '灰色', '颜色'], ['gold', '金色', '颜色'], ['silver', '银色', '颜色'],
  ['six', '六', '数字'], ['seven', '七', '数字'], ['eight', '八', '数字'], ['nine', '九', '数字'], ['ten', '十', '数字'], ['eleven', '十一', '数字'], ['twelve', '十二', '数字'], ['thirteen', '十三', '数字'], ['fourteen', '十四', '数字'], ['fifteen', '十五', '数字'], ['sixteen', '十六', '数字'], ['seventeen', '十七', '数字'], ['eighteen', '十八', '数字'], ['nineteen', '十九', '数字'], ['twenty', '二十', '数字'],
  ['hair', '头发', '身体'], ['face', '脸', '身体'], ['ear', '耳朵', '身体'], ['tooth', '牙齿', '身体'], ['neck', '脖子', '身体'], ['arm', '手臂', '身体'], ['finger', '手指', '身体'], ['leg', '腿', '身体'], ['foot', '脚', '身体'], ['toe', '脚趾', '身体'], ['body', '身体', '身体'],
  ['grandpa', '爷爷', '家庭'], ['grandma', '奶奶', '家庭'], ['brother', '兄弟', '家庭'], ['sister', '姐妹', '家庭'], ['boy', '男孩', '人物'], ['girl', '女孩', '人物'], ['teacher', '老师', '人物'], ['doctor', '医生', '人物'], ['nurse', '护士', '人物'], ['baby', '宝宝', '人物'],
  ['table', '桌子', '家居'], ['chair', '椅子', '家居'], ['sofa', '沙发', '家居'], ['lamp', '灯', '家居'], ['clock', '时钟', '家居'], ['window', '窗户', '家居'], ['wall', '墙', '家居'], ['floor', '地板', '家居'], ['kitchen', '厨房', '家居'], ['bedroom', '卧室', '家居'], ['bathroom', '浴室', '家居'], ['home', '家', '家居'],
  ['pen', '钢笔', '学校'], ['pencil', '铅笔', '学校'], ['eraser', '橡皮', '学校'], ['ruler', '尺子', '学校'], ['bag', '书包', '学校'], ['desk', '课桌', '学校'], ['school', '学校', '学校'], ['classroom', '教室', '学校'], ['picture', '图片', '学校'], ['letter', '字母', '学校'], ['number', '数字', '学校'], ['story', '故事', '学校'],
  ['plane', '飞机', '交通'], ['taxi', '出租车', '交通'], ['truck', '卡车', '交通'], ['van', '面包车', '交通'], ['ship', '轮船', '交通'], ['subway', '地铁', '交通'], ['road', '道路', '交通'], ['bridge', '桥', '交通'], ['wheel', '轮子', '交通'],
  ['tree', '树', '自然'], ['leaf', '树叶', '自然'], ['flower', '花', '自然'], ['grass', '草', '自然'], ['forest', '森林', '自然'], ['river', '河流', '自然'], ['lake', '湖', '自然'], ['sea', '海', '自然'], ['mountain', '山', '自然'], ['sky', '天空', '自然'], ['rainbow', '彩虹', '自然'], ['snow', '雪', '自然'], ['wind', '风', '自然'], ['weather', '天气', '自然'],
  ['circle', '圆形', '形状'], ['square', '正方形', '形状'], ['triangle', '三角形', '形状'], ['rectangle', '长方形', '形状'], ['oval', '椭圆形', '形状'], ['heart', '心形', '形状'], ['diamond', '菱形', '形状'], ['line', '线', '形状'], ['dot', '点', '形状'],
  ['doll', '玩偶', '玩具'], ['kite', '风筝', '玩具'], ['block', '积木', '玩具'], ['robot', '机器人', '玩具'], ['drum', '鼓', '玩具'], ['puzzle', '拼图', '玩具'], ['yo-yo', '悠悠球', '玩具'], ['game', '游戏', '玩具'],
  ['shirt', '衬衫', '衣物'], ['coat', '外套', '衣物'], ['dress', '连衣裙', '衣物'], ['pants', '裤子', '衣物'], ['shoe', '鞋', '衣物'], ['sock', '袜子', '衣物'], ['cap', '帽子', '衣物'], ['skirt', '裙子', '衣物'], ['glove', '手套', '衣物'],
  ['run', '跑', '动作'], ['walk', '走', '动作'], ['jump', '跳', '动作'], ['sit', '坐', '动作'], ['stand', '站', '动作'], ['sleep', '睡觉', '动作'], ['wake', '醒来', '动作'], ['eat', '吃', '动作'], ['drink', '喝', '动作'], ['read', '读', '动作'], ['write', '写', '动作'], ['draw', '画', '动作'], ['sing', '唱', '动作'], ['dance', '跳舞', '动作'], ['swim', '游泳', '动作'], ['open', '打开', '动作'], ['close', '关闭', '动作'], ['wash', '清洗', '动作'], ['help', '帮助', '动作'], ['play', '玩', '动作'],
  ['angry', '生气的', '感受'], ['afraid', '害怕的', '感受'], ['tired', '疲倦的', '感受'], ['hungry', '饥饿的', '感受'], ['thirsty', '口渴的', '感受'], ['kind', '友善的', '感受'], ['brave', '勇敢的', '感受'], ['funny', '有趣的', '感受'], ['good', '好的', '描述'], ['bad', '坏的', '描述'], ['hot', '热的', '描述'], ['cold', '冷的', '描述'], ['new', '新的', '描述'], ['old', '旧的', '描述'], ['long', '长的', '描述'], ['short', '短的', '描述'], ['tall', '高的', '描述'], ['slow', '慢的', '描述'], ['clean', '干净的', '描述'], ['dirty', '脏的', '描述'],
  ['hello', '你好', '表达'], ['goodbye', '再见', '表达'], ['yes', '是', '表达'], ['no', '不', '表达'], ['please', '请', '表达'], ['thanks', '谢谢', '表达'], ['sorry', '对不起', '表达'], ['welcome', '欢迎', '表达'], ['morning', '早晨', '时间'], ['afternoon', '下午', '时间'], ['evening', '傍晚', '时间'], ['night', '夜晚', '时间'], ['today', '今天', '时间'], ['tomorrow', '明天', '时间'], ['Monday', '星期一', '星期'], ['Tuesday', '星期二', '星期'], ['Wednesday', '星期三', '星期'], ['Thursday', '星期四', '星期'], ['Friday', '星期五', '星期'], ['Saturday', '星期六', '星期'], ['Sunday', '星期日', '星期']
];

const allEnglishWords = Array.from(new Map<string, { word: string; translation: string; theme: string }>([
  ...englishWords.map(([word, translation]): [string, { word: string; translation: string; theme: string }] =>
    [word.toLowerCase(), { word, translation, theme: '基础' }]),
  ...extraEnglishWords.map(([word, translation, theme]): [string, { word: string; translation: string; theme: string }] =>
    [word.toLowerCase(), { word, translation, theme }])
]).values());

const traceValues = Array.from(new Set([
  ...'0123456789',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'aoeiuvbpmfdtnlgkhjqxzcszhchshryw',
  ...'一丨丿丶乙亅二亠人人儿入八冂冖冫几凵刀力勹匕匚十卜卩厂厶又口囗土士夂夊夕大女子宀寸小尢尸屮山巛工己巾干幺广廴廾弋弓彐彡彳心戈户手支攴文斗斤方无日曰月木欠止歹殳毋比毛氏气水火爪父爻爿片牙牛犬玄玉瓜瓦甘生用田疋疒癶白皮皿目矛矢石示禸禾穴立竹米糸缶网羊羽老而耒耳聿肉臣自至臼舌舟艮色艸虍虫血行衣襾见角言谷豆豕豸贝赤走足身车辛辰辵邑酉采里金长门阜隶隹雨青非面革韦韭音页风飞食首香马骨高髟斗鬼鱼鸟卤鹿麦麻黄黍黑黹黾鼎鼓鼠鼻齐齿龙龟龠',
  ...allCharacterTitles.slice(0, 220)
]));

const scienceTasks = [
  ['会浮起来吗？', '准备一片树叶和一块小石头，猜一猜谁会浮在水面。'],
  ['影子跟着我', '站在阳光下动动手，观察影子会不会一起动。'],
  ['颜色变变变', '把黄色和蓝色叠在一起看看，会出现什么颜色？'],
  ['听声找物', '闭上眼睛听一听，猜猜家人在敲什么物品。'],
  ['软硬分类', '找三样软软的东西和三样硬硬的东西。'],
  ['谁需要水', '观察家里的植物，说说它为什么需要喝水。'],
  ['磁铁小侦探', '在家长陪伴下，用磁铁找出会被吸住的安全物品。'],
  ['冷与热', '摸一摸常温杯和温水杯，说说感觉有什么不同。'],
  ['叶子不一样', '找两片落叶，比一比颜色、大小和边缘。'],
  ['声音的大小', '轻轻拍手再用力拍手，听听声音哪里不同。'],
  ['小小天气员', '看看窗外，今天是晴天、阴天还是雨天？'],
  ['种子旅行', '观察水果的种子，想想它们怎样去到新的地方。']
];

scienceTasks.push(
  ['水会变少吗？', '在两个相同杯子里放一样多的水，一个盖住、一个不盖，第二天比一比。'],
  ['纸巾吸水比赛', '准备不同纸巾，滴上同样多的水，看看谁吸得最快。'],
  ['会滚还是会滑？', '让球和积木从小斜坡下来，观察它们运动的方式。'],
  ['空气在哪里？', '把空杯子倒扣进水里，观察杯子里是不是还有东西。'],
  ['气球变大了', '在家长帮助下吹气球，感受空气占据了空间。'],
  ['纸飞机远近', '折两架不同的纸飞机，比一比谁飞得更远。'],
  ['什么能溶在水里？', '在家长陪伴下试一试盐、糖和沙子，观察谁能消失在水中。'],
  ['冰块融化比赛', '把两块冰分别放在阳光和阴凉处，猜猜哪一块先变成水。'],
  ['水往低处流', '用积木垫高托盘一边，滴一点水观察它往哪里走。'],
  ['自制小雨', '观察锅盖或透明盖上的小水滴，想想它们从哪里来。'],
  ['物品会不会沉？', '挑选木片、瓶盖、硬币等安全物品，先猜再放入水中验证。'],
  ['颜色爬高', '让白色纸巾一角接触彩色水，观察颜色怎样慢慢向上走。'],
  ['镜子里的我', '照镜子眨左眼、举右手，观察镜子里的动作。'],
  ['光能穿过去吗？', '用手电照纸、塑料袋和纸板，比一比透光程度。'],
  ['彩虹在哪里？', '让阳光穿过装水的透明杯，在白纸上寻找彩色光。'],
  ['影子的长短', '早上和下午在同一位置观察影子，比较它的长短。'],
  ['透明与不透明', '找出三件能看穿和三件不能看穿的物品。'],
  ['反光小侦探', '用手电照镜子、金属勺和布，看看哪个最亮。'],
  ['声音来自振动', '轻轻拨动橡皮筋，观察它发声时是不是在快速抖动。'],
  ['传声筒', '在家长帮助下用纸杯和棉线做传声筒，试试能否听见。'],
  ['高音和低音', '敲击装有不同水量的杯子，听听声音高低。'],
  ['声音会消失吗？', '捂住耳朵再听音乐，说说声音发生了什么变化。'],
  ['回声游戏', '在空房间或安全的开阔处拍手，听一听有没有回声。'],
  ['磁铁隔物吸', '让磁铁隔着一张纸吸回形针，观察磁力能不能穿过去。'],
  ['磁铁有两极', '在家长陪伴下让两块磁铁靠近，感受有时吸引、有时推开。'],
  ['静电小魔法', '用气球摩擦头发，再靠近小纸屑，观察纸屑会不会跳起来。'],
  ['推和拉', '找一扇门、一个抽屉，说说打开它们分别用了推还是拉。'],
  ['摩擦力大不同', '让玩具车分别在地板和毛巾上滑行，比一比距离。'],
  ['斜坡越高越快吗？', '改变积木斜坡的高度，让小车滑下，观察速度变化。'],
  ['平衡高手', '尝试把积木搭高，观察怎样放才不容易倒。'],
  ['身体会长大', '比较自己现在和小时候的衣服或照片，找找变化。'],
  ['心跳在哪里？', '安静时摸摸胸口，跳几下后再摸，感受心跳变化。'],
  ['呼吸小实验', '把手放在鼻子前呼吸，感受呼出的空气。'],
  ['骨头在哪里？', '摸摸手指、手腕和膝盖，找一找身体里的硬骨头。'],
  ['眼睛的保护', '观察远处和近处，讨论看屏幕时为什么要休息。'],
  ['牙齿的形状', '照镜子观察门牙和里面的牙齿，看看形状是否一样。'],
  ['味觉小侦探', '在家长准备下品尝少量甜、酸、咸食物，说出感受。'],
  ['左右手合作', '试着只用一只手扣扣子，再用两只手，比较哪个容易。'],
  ['运动让身体暖', '原地跳十下，感受身体温度和呼吸有什么变化。'],
  ['睡眠帮助成长', '记录一晚的睡觉和起床时间，讨论充足睡眠的好处。'],
  ['种子里面有什么？', '在家长帮助下掰开泡软的豆子，观察里面的结构。'],
  ['植物向光长', '把一盆植物放在窗边，几天后观察叶子朝向。'],
  ['叶子会喝水', '把带茎白花或菜叶插进彩色水中，观察颜色变化。'],
  ['根在哪里？', '观察葱、豆芽或小草的根，比较根和叶子的不同。'],
  ['植物需要什么？', '比较有水和没水的小苗，讨论阳光、水和空气的重要性。'],
  ['果实藏种子', '切开苹果、橙子和西红柿，寻找种子藏在哪里。'],
  ['花的不同', '比较两种花的颜色、花瓣数量和气味。'],
  ['树皮的纹路', '用纸覆盖树干并轻轻涂色，拓印树皮纹路。'],
  ['落叶为什么变色？', '收集不同颜色落叶，按绿色、黄色、红色分类。'],
  ['小动物吃什么？', '给常见动物和它爱吃的食物配对。'],
  ['动物怎样移动？', '模仿鸟飞、鱼游、兔跳和蛇爬，比较动作。'],
  ['谁住在哪里？', '把鱼、鸟、蚂蚁、熊分别放到合适的生活环境。'],
  ['动物的外衣', '比较羽毛、鳞片、毛发和硬壳的不同作用。'],
  ['白天和夜晚的动物', '说说白天常见的小鸟和夜晚活动的猫头鹰有什么不同。'],
  ['昆虫有几条腿？', '观察蚂蚁或昆虫图片，数一数它们有几条腿。'],
  ['蜗牛的路线', '雨后安全观察蜗牛走过的痕迹，不触碰、不伤害。'],
  ['鸟嘴不一样', '观察鸭子、麻雀和啄木鸟图片，比较鸟嘴形状。'],
  ['动物怎么过冬？', '了解迁徙、冬眠和换厚毛三种过冬办法。'],
  ['天气符号', '认识晴、阴、雨、雪、风五种天气符号。'],
  ['云会移动', '选一朵云连续观察几分钟，看看位置和形状的变化。'],
  ['雨量小记录', '下雨时把安全容器放在户外，雨停后观察收集的雨水。'],
  ['风从哪边来？', '用纸条做风向标，观察纸条飘向哪一边。'],
  ['今天穿什么？', '根据温度和天气选择合适衣服，并说出理由。'],
  ['四季的树', '找春夏秋冬同一棵树的图片，按季节排序。'],
  ['月亮会变化', '连续几晚在家长陪伴下看月亮，画下它的形状。'],
  ['太阳东升西落', '早晨和傍晚观察太阳方向，注意绝不直视太阳。'],
  ['地球是我们的家', '看地球仪，找一找蓝色海洋和不同陆地。'],
  ['白天与黑夜', '用球和手电模拟太阳照亮地球的一面。'],
  ['垃圾分类', '把纸盒、果皮、旧电池和塑料瓶放进对应分类图。'],
  ['节约每一滴水', '刷牙时关水龙头，估一估能少流掉多少水。'],
  ['纸可以再利用', '用废纸背面画画或折纸，讨论为什么要节约纸张。'],
  ['清洁空气', '观察路边和公园的空气环境，说说少开车的好处。'],
  ['保护小动物', '讨论遇到昆虫和小鸟时怎样安静观察、不伤害它们。'],
  ['安全用电', '寻找家里的插座，在家长陪伴下学习不触碰插孔。'],
  ['厨房里的变化', '观察鸡蛋加热前后的变化，只看不碰热锅。'],
  ['面团变大了', '观察发酵面团前后大小，猜猜里面有什么让它鼓起来。'],
  ['水果变色', '切开的苹果放一会儿会变色，滴柠檬汁后再比较。'],
  ['盐水浮力', '在家长帮助下往水里慢慢加盐，观察鸡蛋是否更容易浮起。'],
  ['自制小船', '用瓶盖、锡纸或树叶做小船，看看哪种能载更多小豆子。'],
  ['搭一座桥', '用纸和积木搭桥，尝试改变纸的形状让桥更结实。'],
  ['降落伞', '用纸巾和线做小降落伞，观察它为什么慢慢落下。'],
  ['会跳舞的葡萄干', '在家长陪伴下把葡萄干放入气泡水，观察上下移动。'],
  ['泡泡为什么是圆的？', '吹几个安全泡泡，观察大泡泡和小泡泡的形状。'],
  ['小苏打火山', '由家长操作小苏打和醋，孩子远距离观察产生的泡沫。'],
  ['指纹不一样', '用可清洗印泥留下家人的指纹，比较纹路。'],
  ['找规律的自然', '观察花瓣、松果或叶序，寻找重复排列。'],
  ['一分钟有多长？', '计时一分钟，看看能拍多少次手、搭多少块积木。'],
  ['温度计会变化', '在家长陪伴下观察室内外温度计数字的不同。'],
  ['地图小方向', '在简单房间地图上标出门、窗和玩具的位置。'],
  ['材料大分类', '把安全物品按木头、金属、塑料、布料分类。']
);

function buildMathItems(): ContentItem[] {
  const stageNames = ['数感启蒙', '10以内数量', '10以内运算', '规律分类', '形状测量', '逻辑空间'];
  const optionNumbers = (answer: number, max = 20) => Array.from(new Set([Math.max(0, answer - 1), answer, Math.min(max, answer + 1)])).map(String);
  const templates: Array<(n: number) => { prompt: string; answer: string; options: string[] }> = [
    (n) => {
      const mode = n % 4;
      const value = n % 11;
      if (mode === 0) return { prompt: `${'●'.repeat(value || 1)} 一共有几个圆点？`, answer: String(value || 1), options: optionNumbers(value || 1, 10) };
      if (mode === 1) return { prompt: `${value} 后面的一个数字是什么？`, answer: String(value + 1), options: optionNumbers(value + 1, 12) };
      if (mode === 2) return { prompt: `${value + 1} 前面的一个数字是什么？`, answer: String(value), options: optionNumbers(value, 12) };
      return { prompt: `从 ${value} 开始数两个数，会数到几？`, answer: String(value + 1), options: optionNumbers(value + 1, 12) };
    },
    (n) => {
      const a = n % 9;
      const b = (n * 3 + 2) % 10;
      if (n % 4 === 0) return { prompt: `${a} 和 ${b}，哪个更多？`, answer: String(Math.max(a, b)), options: [String(a), String(b), '一样多'] };
      if (n % 4 === 1) return { prompt: `${a} 和 ${a}，数量怎么样？`, answer: '一样多', options: [String(a), '一样多', '不知道'] };
      if (n % 4 === 2) return { prompt: `${a} 添上几个能变成 ${a + 2}？`, answer: '2', options: ['1', '2', '3'] };
      return { prompt: `把 ${Math.min(10, a + 3)} 分成 ${a} 和几？`, answer: String(Math.min(10, a + 3) - a), options: optionNumbers(Math.min(10, a + 3) - a, 10) };
    },
    (n) => {
      const a = n % 6 + 1;
      const b = n % 3 + 1;
      if (n % 2 === 0) return { prompt: `${a} + ${b} = ?`, answer: String(a + b), options: optionNumbers(a + b, 10) };
      return { prompt: `${a + b} − ${b} = ?`, answer: String(a), options: optionNumbers(a, 10) };
    },
    (n) => {
      const patterns = [
        { prompt: '○ △ ○ △ ○，下一个是什么？', answer: '△', options: ['○', '△', '□'] },
        { prompt: '红 蓝 蓝 红 蓝 蓝，下一个是什么颜色？', answer: '红', options: ['红', '蓝', '黄'] },
        { prompt: '1，2，1，2，1，下一个数是？', answer: '2', options: ['1', '2', '3'] },
        { prompt: '大，小，大，小，下一个是？', answer: '大', options: ['大', '小', '一样'] },
        { prompt: '哪一个不是水果？', answer: '小汽车', options: ['苹果', '香蕉', '小汽车'] },
        { prompt: '哪一个和其他两个不一样？', answer: '三角形', options: ['红圆', '蓝圆', '三角形'] },
        { prompt: '拍手、跺脚、拍手、跺脚，接下来做什么？', answer: '拍手', options: ['拍手', '跺脚', '坐下'] },
        { prompt: '春、夏、秋、冬、春，接下来是？', answer: '夏', options: ['夏', '秋', '冬'] }
      ];
      return patterns[n % patterns.length];
    },
    (n) => {
      const questions = [
        { prompt: '哪个图形没有角？', answer: '圆形', options: ['圆形', '三角形', '正方形'] },
        { prompt: '哪个图形有3条边？', answer: '三角形', options: ['圆形', '三角形', '正方形'] },
        { prompt: '哪个图形有4条一样长的边？', answer: '正方形', options: ['长方形', '三角形', '正方形'] },
        { prompt: '哪一个更长？', answer: '长铅笔', options: ['短铅笔', '长铅笔'] },
        { prompt: '哪一个更重？', answer: '大象', options: ['羽毛', '大象'] },
        { prompt: '哪一个能装更多水？', answer: '大桶', options: ['小杯', '大桶'] },
        { prompt: '早上起床后，下一件事更可能是什么？', answer: '刷牙', options: ['刷牙', '吃晚饭', '睡觉'] },
        { prompt: '半个西瓜和一个完整西瓜，哪个更多？', answer: '完整西瓜', options: ['半个西瓜', '完整西瓜'] }
      ];
      return questions[n % questions.length];
    },
    (n) => {
      const questions = [
        { prompt: '小熊面向左边，转身后面向哪边？', answer: '右边', options: ['左边', '右边'] },
        { prompt: '红球在盒子里面，蓝球在盒子外面，谁在里面？', answer: '红球', options: ['红球', '蓝球'] },
        { prompt: '小猫在桌子下面，小狗在桌子上面，谁在上面？', answer: '小狗', options: ['小猫', '小狗'] },
        { prompt: '从家先到公园，再到学校，第二个到哪里？', answer: '公园', options: ['家', '公园', '学校'] },
        { prompt: '三只小鸭排队，黄鸭前面有一只，后面有一只，黄鸭排第几？', answer: '第二', options: ['第一', '第二', '第三'] },
        { prompt: '积木藏在不透明盒子里，能直接看到吗？', answer: '不能', options: ['能', '不能'] },
        { prompt: '小兔向前走2步，再退1步，一共向前了几步？', answer: '1步', options: ['1步', '2步', '3步'] },
        { prompt: '先穿袜子还是先穿鞋？', answer: '先穿袜子', options: ['先穿袜子', '先穿鞋'] }
      ];
      return questions[n % questions.length];
    }
  ];

  return stageNames.flatMap((stageName, stageIndex) => Array.from({ length: 40 }, (_, offset) => {
    const value = templates[stageIndex](offset + stageIndex);
    return {
      id: `math-${stageIndex + 1}-${offset + 1}`,
      module: 'math' as const,
      kind: 'math-choice' as const,
      title: `${stageName} ${offset + 1}`,
      stage: stageIndex + 1,
      ...value,
      source: 'builtin' as const
    };
  }));
}

export const BUILTIN_CONTENT: ContentItem[] = ([
  ...poems.map(({ title, author, dynasty, body, grade }, index): ContentItem => ({
    id: `poem-${index + 1}`, module: 'guoxue', kind: 'poem', title, subtitle: `${dynasty}·${author}`, body,
    tags: [grade <= 6 ? '小学古诗' : '初中古诗', `${grade}年级`],
    ...poemAgeRange(grade, index < 65), source: 'builtin'
  })),
  {
    id: 'classic-1', module: 'guoxue', kind: 'classic', title: '三字经·节选',
    body: '人之初，性本善。\n性相近，习相远。\n苟不教，性乃迁。\n教之道，贵以专。', source: 'builtin'
  },
  ...[
    ['弟子规·节选', '弟子规，圣人训。首孝悌，次谨信。泛爱众，而亲仁。有余力，则学文。'],
    ['千字文·节选', '天地玄黄，宇宙洪荒。日月盈昃，辰宿列张。寒来暑往，秋收冬藏。'],
    ['论语·学而', '学而时习之，不亦说乎？有朋自远方来，不亦乐乎？'],
    ['论语·为政', '温故而知新，可以为师矣。'],
    ['论语·述而', '三人行，必有我师焉。择其善者而从之，其不善者而改之。'],
    ['孟子·节选', '爱人者，人恒爱之；敬人者，人恒敬之。'],
    ['大学·节选', '大学之道，在明明德，在亲民，在止于至善。'],
    ['中庸·节选', '博学之，审问之，慎思之，明辨之，笃行之。'],
    ['朱子家训·节选', '一粥一饭，当思来处不易；半丝半缕，恒念物力维艰。'],
    ['增广贤文·节选', '一寸光阴一寸金，寸金难买寸光阴。']
  ].map(([title, body], index): ContentItem => ({
    id: `classic-${index + 2}`, module: 'guoxue', kind: 'classic', title, body,
    subtitle: `掌握${(index + 2) * 10}首古诗后解锁`, source: 'builtin'
  })),
  ...allCharacters.map(({ title, subtitle, body, exampleWord }, index): ContentItem => ({
    id: `char-${index + 1}`, module: 'literacy', kind: 'character', title, subtitle, body, exampleWord, source: 'builtin'
  })),
  ...buildMathItems(),
  ...curriculum.letters.map(([upper, lower, example, translation, emoji], index): ContentItem => ({
    id: `letter-${lower}`, module: 'english', kind: 'letter', title: `${upper} ${lower}`,
    subtitle: `字母 ${upper}`, body: `${emoji} ${example} · ${translation}`, tags: ['字母启蒙'], source: 'builtin', stage: 0
  })),
  ...allEnglishWords.map(({ word, translation, theme }, index): ContentItem => ({
    id: `word-${index + 1}`, module: 'english', kind: 'word', title: word, body: translation, tags: [theme], source: 'builtin', stage: 1
  })),
  ...[
    ['reader-1', '小猫找朋友', 'Cat sees a dog.\nCat sees a bird.\nHello, friends!'],
    ['reader-2', '五个小苹果', 'One apple. Two apples.\nThree, four, five.\nYummy apples!'],
    ['reader-3', '晚安，月亮', 'The sun goes down.\nThe moon comes up.\nGood night!'],
    ['reader-4', '我的红球', 'I see a red ball.\nThe ball can bounce.\nBounce, ball, bounce!'],
    ['reader-5', '农场早上好', 'Good morning, cow.\nGood morning, duck.\nGood morning, little farm!'],
    ['reader-6', '下雨啦', 'Rain, rain, come and play.\nI have my boots.\nSplash, splash, splash!'],
    ['reader-7', '彩虹颜色', 'Red and yellow, green and blue.\nI see a rainbow.\nDo you see it too?'],
    ['reader-8', '小小种子', 'A little seed is in the ground.\nSun and water help it grow.\nHello, flower!'],
    ['reader-9', '五只小鸭', 'Five little ducks can swim.\nOne, two, three, four, five.\nCome home, ducks!'],
    ['reader-10', '我会自己做', 'I can wash my hands.\nI can put on my shoes.\nI can help at home.'],
    ['reader-11', '去公园', 'We walk to the park.\nI see trees and birds.\nWhat a happy day!'],
    ['reader-12', '月亮晚安', 'The sky is dark.\nThe stars are bright.\nGood night, moon.']
  ].map(([id, title, body]): ContentItem => ({ id, module: 'english', kind: 'reader', title, body, subtitle: '原创示例绘本', source: 'builtin' })),
  ...traceValues.map((title, index): ContentItem => ({
    id: `trace-${index + 1}`, module: 'writing', kind: 'trace', title, subtitle: '沿着浅色笔画慢慢描', source: 'builtin'
  })),
  ...scienceTasks.map(([title, body], index): ContentItem => ({
    id: `science-${index + 1}`, module: 'science', kind: 'science', title, body, source: 'builtin'
  }))
] as ContentItem[]).map(ensureContentAge);

export const DEFAULT_REWARDS: RewardDefinition[] = [
  { id: 'music', title: '听音乐10分钟', icon: '🎵', currency: 'stars', cost: 20, enabled: true, pricingVersion: 2 },
  { id: 'snack', title: '一份小零食', icon: '🍪', currency: 'stars', cost: 20, enabled: true },
  { id: 'cartoon', title: '看动画 15 分钟', icon: '📺', currency: 'stars', cost: 30, enabled: true },
  { id: 'pocket-money', title: '零花钱 2 元', icon: '🪙', currency: 'badges', cost: 2, enabled: true }
];
