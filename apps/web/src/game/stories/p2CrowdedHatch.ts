import crowded from "../../assets/stories/p2-hatch-v1/01-crowded-doors.png";
import charcoal from "../../assets/stories/p2-hatch-v1/02-charcoal-vip.png";
import again from "../../assets/stories/p2-hatch-v1/03-rush-hour-again.png";
import application from "../../assets/stories/p2-hatch-v1/04-extra-mouths.png";
import terminals from "../../assets/stories/p2-hatch-v1/05-clock-out-rejected.png";
import type { Story } from "./definitions";
import { p2HatchStoryID } from "./progress";

export const p2CrowdedHatch: Story = {
  id: p2HatchStoryID,
  title: "P2 前期：舱门过于拥挤",
  pages: [
    {
      title: "工厂很大，门口很小",
      image: crowded,
      alt: "旧版插图：宽敞厂房里，中央仓库却被传送带与物料挤满；电视头厂长举着规划图，面对空地与门口的鲜明反差。",
      paragraphs: [
        "工厂开饭后，大家的胃口都很好。",
        "铁板要出去，齿轮要出去，做好的零件还要回来。",
        "你给机器规划了宽敞的厂房，给传送带留下了体面的走廊。",
        "然后，所有东西都挤在仓库门口。",
        "空地多到可以举办运动会，舱门挤到只能举办摔跤比赛。",
      ],
    },
    {
      title: "生物炭走贵宾通道",
      image: charcoal,
      alt: "旧版插图：戴墨镜的生物炭享用专属红毯燃料通道，其他零件挤成长队；电视头厂长拦住试图蹭红毯的齿轮。",
      paragraphs: [
        "你试着给每个舱门安排固定工作。",
        "三个负责取货，一个负责存入，看起来十分合理。",
        "直到固燃传动机表示，它也要吃饭。",
        "于是，生物炭拥有了一条专用通道，其他零件开始侧着身子上班。",
        "你抱着空杯子看了好一会儿：唔，厂里待遇最好的，居然是一块准备被烧掉的炭。",
      ],
    },
    {
      title: "再开一间，问题再来一遍",
      image: again,
      alt: "旧版插图：几间大片空地的厂房里，仓库门口都挤着同样的队伍；电视头厂长搬着折叠椅走向下一座厂房。",
      paragraphs: [
        "你决定换个更有发展空间的地方。",
        "新厂房很宽敞，新仓库也很精神。",
        "你接上原料，接上燃料，再给成品留一条回家的路。",
        "新仓库的门口，很快也变得十分眼熟。",
        "你抱着折叠椅站在门口，轻轻叹气。工厂多了几座，早高峰多了几份，午睡的位置却还没找到。",
      ],
    },
    {
      title: "给仓库申请几张嘴",
      image: application,
      alt: "旧版插图：电视头厂长带着铁板与铜条递交申请；后勤终端上的仓库示意图长出几张卡通嘴，机械臂正在盖章。",
      paragraphs: [
        "你向后勤系统提交了《增设仓库取货及存入终端申请》。",
        "系统回复：「现有舱门状态良好，均可正常开合。」",
        "你附上了门口的照片，以及基础铁板五十块、铜条五十根。",
        "系统沉默片刻，将问题分类从「舱门维修」改成了「舱门不够」。",
        "申请终于通过了。看来，有些话得用铁板和铜条一起说。",
      ],
    },
    {
      title: "嘴可以多长几个",
      image: terminals,
      alt: "旧版插图：改造图中的取货终端让两种物料轮流出场，存入终端四面接货；电视头厂长的折叠椅旁还夹着待批的下班申请。",
      paragraphs: [
        "现在，你可以给每座工厂单独增设取货终端和存入终端了。",
        "原料换个地方出门，成品就近回仓，不必全厂挤在同一个窗口。",
        "你趴在桌边，慢慢添上几个终端，又认真给未来的产线留出位置。躺椅的位置，也顺手留了一小块。",
        "随后，你把下班申请悄悄夹进设计图：「这张也一起批一下，好不好？」",
        "系统批注：「此处接收工业成品。厂长尚未完成加工。」……唔，连下班都要排工序呀。",
      ],
    },
  ],
};
