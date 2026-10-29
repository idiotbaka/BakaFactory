import contract from "../../assets/stories/opening-ai09-v1/01-galactic-contract.png";
import promotion from "../../assets/stories/opening-ai09-v1/02-promoted-factory-chief.png";
import recruitment from "../../assets/stories/opening-ai09-v1/03-zero-applicants.png";
import colleagues from "../../assets/stories/opening-ai09-v1/04-build-colleagues.png";
import clockOut from "../../assets/stories/opening-ai09-v1/05-plan-to-clock-out.png";
import partsWithinParts from "../../assets/stories/p1-feast-v1/01-parts-within-parts.png";
import handsLearnTheJob from "../../assets/stories/p1-feast-v1/02-hands-learn-the-job.png";
import graduationMaterials from "../../assets/stories/p1-feast-v1/03-graduation-becomes-materials.png";
import tastingMenu from "../../assets/stories/p1-feast-v1/04-factory-tasting-menu.png";
import factoryHungry from "../../assets/stories/p1-feast-v1/05-factory-is-hungry.png";
import { openingStoryID, p1StoryID, storyIDs, type StoryID } from "./progress";
import { p2CrowdedHatch } from "./p2CrowdedHatch";
import { p2ShaftOverload } from "./p2ShaftOverload";
import { p2ClockworkColleague } from "./p2ClockworkColleague";

export type StoryPage = {
  title: string;
  image: string;
  alt: string;
  paragraphs: string[];
  pixelArt?: boolean;
};
export type Story = { id: StoryID; title: string; pages: StoryPage[] };
export const storyDefinitions: Record<StoryID, Story> = {
  p2_crowded_hatch: p2CrowdedHatch,
  p2_shaft_overload: p2ShaftOverload,
  p2_clockwork_colleague: p2ClockworkColleague,
  [p1StoryID]: {
    id: p1StoryID,
    title: "P1：工厂开饭了",
    pages: [
      {
        title: "零件里面，怎么还有零件",
        image: partsWithinParts,
        alt: "旧版插图：电视头厂长坐在工作室的零件堆前，夹爪拿着锤子与配方纸，身后便签上的零件依赖箭头绕回自己。",
        paragraphs: [
          "为了装好一个零件，你得先做好另外几个零件。",
          "而为了做好另外几个零件，你又打开了更多的配方，层层循环～",
          "工作台上的图纸越堆越满。你托着脸想了半天，最初想做的零件，已经被压到最底下了。",
          "你看着忙了好几天的双手，慢慢冒出一个小念头。",
          "要是有谁能帮忙接着做……我就可以把袖子放下来，歇一小会儿了吧。",
        ],
      },
      {
        title: "给双手补上一点工作经验",
        image: handsLearnTheJob,
        alt: "旧版插图：电视头厂长在暖灯下打盹，套在夹爪腕部的齿轮外骨骼继续装配，旁边终端以图标显示材料到成品的顺序队列。",
        paragraphs: [
          "于是，流水线机械手诞生了。给工作室添一位帮手，总比让自己的手加班好一点。",
          "你指定成品，它会帮你清点材料，把需要补做的配方排好顺序。",
          "机械手很智能，它会先做中间件，再做下一道工序，还会考虑到中间产物的复用。",
          "终于不用反复惦记配方了。你趴在桌边眯了一小会儿；工厂保持在线运转，醒来时，这份订单已经做好了～",
          "你伸出袖口里的手，轻轻拍了拍它：「做得好，今天的午睡名额分你一半……你应该不需要吧？」",
        ],
      },
      {
        title: "毕业作品，被归进了原料区",
        image: graduationMaterials,
        alt: "旧版插图：戴纸箱毕业帽的电视头厂长捧着零件盒，仓库图册将小零件标入大机器，料箱上贴着原料标签。",
        paragraphs: [
          "你郑重地收好成品，戴上纸箱做的毕业帽。唔，总算可以从手工作坊毕业了吧。",
          "然而，垃圾的消耗速度远不及运来的速度，新阶段的设备图册展开了。",
          "那些攒了很久的齿轮、铁板和密封圈，全都出现在新阶段的材料栏里。",
          "原来，它们还要装进更大的机器，成为里面很小的一部分。",
          "你扶了扶纸箱帽，把刚写好的下班申请又压回图纸底下。包装盒还是先留着吧。",
        ],
      },
      {
        title: "大机器没有小胃口",
        image: tastingMenu,
        alt: "旧版插图：图册冒出紫色想象云，传动设备、锅炉与装配机像巨大食客举起材料图标餐牌，电视头厂长端着一小盒零件和迷你餐叉。",
        paragraphs: [
          "而且，造出这些机器只是个开始。",
          "想让它们持续运转，就得不断送来原料、燃料和配套零件。",
          "你在工作室认真加工的一整批零件，可能只够产线忙上一小会儿。",
          "你端着那盒成品，半睁着眼睛，安静地和材料清单对视了一会儿。",
          "这哪里是工业储备。这是给工厂尝尝咸淡。",
        ],
      },
      {
        title: "工厂开饭了",
        image: factoryHungry,
        alt: "旧版插图：电视头厂长摘下纸箱毕业帽，在空厂房拉线测量，腕部机械手夹着图纸，地面以淡紫色构想线勾出未来设备和传送带。",
        paragraphs: [
          "你把零件送回仓库，在空厂房里拉出了第一条定位线。",
          "工作室能帮你做好你临时需要的一批，接下来，该让产线自动生产那些零件了。",
          "分拣、加工、运输，每一道都得有人——或者有机器接上。",
          "你把蓝色刘海拨到一边，重新展开图纸。大家伙们的位置要留好，自己少跑几步的路线也要留好。",
          "它们还没造出来，你已经像听见了工厂的肚子叫。好啦好啦，先开饭，再想办法下班～",
        ],
      },
    ],
  },
  [openingStoryID]: {
    id: openingStoryID,
    title: "开场：下班计划开启",
    pages: [
      {
        title: "一笔成功的生意",
        image: contract,
        pixelArt: true,
        alt: "人类移民船驶离地球，满载旧电器的垃圾货船迎面而来；地球弧面旁立着笑脸回收标志。",
        paragraphs: [
          "人类离开地球前，与「银河文明废弃物综合服务集团」签下了一份长期合同。",
          "从此，全宇宙的废弃机械、过期电器和不方便解释的东西，都可以运到地球统一回收～",
          "集团获得了处理场，人类也获得了移民经费。",
          "双方都很满意。",
          "至于负责处理垃圾的员工，人类表示：「已经安排好了。」",
        ],
      },
      {
        title: "员工已经安排好了",
        image: promotion,
        pixelArt: true,
        alt: "蓝色短发的 09 号托腮窝在办公椅里，制服胸前印着 09，手里的长清单绕过空椅；身后是晋升奖章、六部门图标与落日下的废料场。",
        paragraphs: [
          "你是 09 号，一位拥有蓝色短发和仿生身体的具身 AI。制服上的「09」是编号，半睁的眼睛则是日常。",
          "你原本负责回收作业，最擅长的事是把工作安排妥当，再找个角落安静待一会儿。可惜，人类同事全走了，你被自动晋升成了厂长。",
          "生产、物流、能源、维修、人事和保洁，六个部门，恰好只剩你一位员工。",
          "你把脸往袖子里埋了埋，翻到任命通知的最后一行：",
          "「岗位虽有调整，请继续保持亲自动手的优良传统。」……唔，这个传统可以不保持吗？",
        ],
      },
      {
        title: "一次积极的招聘尝试",
        image: recruitment,
        pixelArt: true,
        alt: "侧面镜头中，09 号托着脸看向右侧招聘终端，屏幕上是人形图标和数字 0；身后留着空办公椅，窄窗外垃圾货船仍在夕阳下卸货。",
        paragraphs: [
          "你认真算了算：这份工作，至少需要一位同事。最好还能轮流午睡。",
          "于是，招聘信息上线了：免费住宿、原材料管够，以及一眼望不到头的发展空间。",
          "招聘系统很努力，替你搜索了整个地球——",
          "人类候选人：0。「唔……真的一个都没留下呀。」",
          "人事系统建议：「可以适当降低候选人的含碳量要求。」",
          "你低头看了看袖口露出的仿生手指，又望向窗外的零件堆。也是，谁规定同事一定要是人类呢。",
        ],
      },
      {
        title: "同事可以自己制造",
        image: colleagues,
        pixelArt: true,
        alt: "09 号托着脸在工作台上画搬运机器人图纸，旁边放着齿轮与线轴；终端上的绿色对勾批准了她的小计划。",
        paragraphs: [
          "你慢吞吞地抽出一张图纸。同事嘛……自己造一位，好像也可以。",
          "先让小车帮忙搬东西，再请维修机器人照看设备。等材料和能源攒够，就造能自己判断、独立接班的 AI 同事。",
          "想让这个小愿望成真，得先从垃圾里拆出材料，把工厂一点点搭起来。为了以后少干一点，现在先努力一点点吧。",
          "财务系统很快批准了计划。你还没来得及高兴，它就补上了登记结果：",
          "「新增办公设备。」……好吧，同事的工牌，以后再偷偷补给它们。",
        ],
      },
      {
        title: "一份认真的下班计划",
        image: clockOut,
        pixelArt: true,
        alt: "从身后望去，09 号站在回收厂门口，手轻搭空躺椅，面向海上的金色落日；回收与小猫图案招牌倚在门边，旁边是垃圾包和等待交接的终端。",
        paragraphs: [
          "值班协议写得很清楚：离岗前，必须把工作交给能够独立作业的同事。",
          "能按指令干活还不够。你需要一位会照看工厂、遇到问题能自己拿主意的伙伴，才能放心把值班表交出去。",
          "然后，就可以窝进那把躺椅，把袖子拉过手背，安安静静看一场落日。只看落日，暂时不看工作清单。",
          "远处的垃圾船又来了。你轻轻叹了口气，给这个计划起了个很认真的名字：「下班计划」。",
          "唔，先从十二包垃圾开始吧。未来的午睡，就拜托今天的自己啦～",
        ],
      },
    ],
  },
};
export const stories = storyIDs.map((id) => storyDefinitions[id]);
