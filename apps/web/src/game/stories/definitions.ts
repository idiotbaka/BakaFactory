import contract from "../../assets/stories/opening-v1/01-galactic-contract.png";
import promotion from "../../assets/stories/opening-v1/02-promoted-factory-chief.png";
import recruitment from "../../assets/stories/opening-v1/03-zero-applicants.png";
import colleagues from "../../assets/stories/opening-v1/04-build-colleagues.png";
import clockOut from "../../assets/stories/opening-v1/05-plan-to-clock-out.png";
import partsWithinParts from "../../assets/stories/p1-feast-v1/01-parts-within-parts.png";
import handsLearnTheJob from "../../assets/stories/p1-feast-v1/02-hands-learn-the-job.png";
import graduationMaterials from "../../assets/stories/p1-feast-v1/03-graduation-becomes-materials.png";
import tastingMenu from "../../assets/stories/p1-feast-v1/04-factory-tasting-menu.png";
import factoryHungry from "../../assets/stories/p1-feast-v1/05-factory-is-hungry.png";
import { openingStoryID, p1StoryID, storyIDs, type StoryID } from "./progress";

export type StoryPage = {
  title: string;
  image: string;
  alt: string;
  paragraphs: string[];
};
export type Story = { id: StoryID; title: string; pages: StoryPage[] };
export const storyDefinitions: Record<StoryID, Story> = {
  [p1StoryID]: {
    id: p1StoryID,
    title: "P1：工厂开饭了",
    pages: [
      {
        title: "零件里面，怎么还有零件",
        image: partsWithinParts,
        alt: "BAKA-01 坐在工作室的零件堆前，夹爪拿着锤子与配方纸，身后便签上的零件依赖箭头绕回自己。",
        paragraphs: [
          "为了装好一个零件，你得先做好另外几个零件。",
          "为了做好另外几个零件，你又打开了更多配方。",
          "工作台越来越满，最初想做什么却越来越模糊。",
          "你看着自己的双手，产生了一个朴素的念头。",
          "它们都跟了我这么久，也该学会自己干了。",
        ],
      },
      {
        title: "给双手补上一点工作经验",
        image: handsLearnTheJob,
        alt: "BAKA-01 在暖灯下打盹，套在夹爪腕部的齿轮外骨骼继续装配，旁边终端以图标显示材料到成品的顺序队列。",
        paragraphs: [
          "于是，流水线机械手诞生了。",
          "你指定成品，它清点材料，把需要补做的配方排好顺序。",
          "先做中间件，再做下一道，一步也不用你反复惦记。",
          "你试着趴下打了个盹，醒来时，队列已经完成。",
          "很好。你的手，终于拥有了独立完成作业的能力。",
        ],
      },
      {
        title: "毕业作品，被归进了原料区",
        image: graduationMaterials,
        alt: "戴纸箱毕业帽的 BAKA-01 捧着零件盒，仓库图册将小零件标入大机器，料箱上贴着原料标签。",
        paragraphs: [
          "你郑重收好成品，准备宣布自己从手工作坊毕业。",
          "然后，新阶段的设备图册展开了。",
          "那些攒了很久的齿轮、铁板和密封圈，全都出现在材料栏里。",
          "原来，它们还要装进更大的机器，成为里面很小的一部分。",
          "你低头看了一眼毕业帽，决定先别扔包装盒。",
        ],
      },
      {
        title: "大机器没有小胃口",
        image: tastingMenu,
        alt: "图册冒出紫色想象云，传动设备、锅炉与装配机像巨大食客举起材料图标餐牌，BAKA-01 端着一小盒零件和迷你餐叉。",
        paragraphs: [
          "而且，造出机器只是开始。",
          "想让它们持续运转，就得不断送来原料、燃料和配套零件。",
          "你在工作室认真加工的一整批，可能只够产线忙上一小会儿。",
          "你端着那盒成品，忽然觉得分量轻了很多。",
          "这哪里是工业储备。这是给工厂尝尝咸淡。",
        ],
      },
      {
        title: "工厂开饭了",
        image: factoryHungry,
        alt: "BAKA-01 摘下纸箱毕业帽，在空厂房拉线测量，腕部机械手夹着图纸，地面以淡紫色构想线勾出未来设备和传送带。",
        paragraphs: [
          "你把零件送回仓库，在空厂房里拉出了第一条定位线。",
          "工作室能帮你做好一批，接下来，要让整条产线接着做。",
          "分拣、加工、运输，每一道都得有人——或者有机器接上。",
          "你重新展开图纸，开始安排这些大家伙的位置。",
          "它们还没造出来，你已经听见了肚子叫。",
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
        alt: "人类移民船驶向星空，垃圾货船排队飞向地球；广告牌写着：您的文明，我们善后。",
        paragraphs: [
          "人类离开地球前，与「银河文明废弃物综合服务集团」签下了一份长期合同。",
          "从此，全宇宙的废弃机械、过期电器和不方便解释的东西，都可以运到地球统一回收。",
          "集团获得了处理场，人类获得了移民经费。",
          "双方都很满意。",
          "至于负责处理垃圾的员工，人类表示：已经安排好了。",
        ],
      },
      {
        title: "员工已经安排好了",
        image: promotion,
        alt: "BAKA-01 在垃圾堆中开机，面对厂长任命通知和绕过六张空办公椅的长长工作清单。",
        paragraphs: [
          "你是 BAKA-01，一台老旧的回收作业机器人。",
          "过去，你的工作是分拣废品。现在，由于其他员工均已离开地球，你被自动晋升为回收厂厂长。",
          "生产、物流、能源、维修、人事和保洁，全部由你负责。",
          "任命通知的最后一行写着：",
          "「岗位虽有调整，请继续保持亲自动手的优良传统。」",
        ],
      },
      {
        title: "一次积极的招聘尝试",
        image: recruitment,
        alt: "BAKA-01 坐在废铁办公桌前，屏幕显示可用人类候选人：0；空椅子后方垃圾船仍在卸货。",
        paragraphs: [
          "你认为，这份工作至少需要两个人。",
          "于是，你发布了招聘信息：免费住宿、无限原材料，以及非常广阔的发展空间。",
          "招聘系统搜索了整个地球。",
          "人类候选人：0。原来他们真的全走了。",
          "人事系统建议：「适当降低候选人的含碳量要求。」",
          "你看了看自己的机械手，又看了看窗外堆积如山的零件。",
        ],
      },
      {
        title: "同事可以自己制造",
        image: colleagues,
        alt: "BAKA-01 在铁片、齿轮和电线之间绘制机器人图纸，财务终端批准了新的办公设备。",
        paragraphs: [
          "你突然想到，同事也可以自己制造。",
          "先造能搬东西的，再造会修机器的。等能源和零件足够，还可以造出能够独立思考的机器人。",
          "为此，你需要从垃圾里拆出材料，一点点建起整座工厂。",
          "财务系统批准了这个计划。",
          "它把新同事登记为「办公设备」，并对你坚持不增加员工编制的做法表示赞赏。",
        ],
      },
      {
        title: "一份认真的下班计划",
        image: clockOut,
        alt: "BAKA-01 竖起 Baka 回收厂招牌，身边是垃圾包、等待工作交接的终端，以及面向落日的空躺椅。",
        paragraphs: [
          "你的值班协议规定：离岗前，必须将工作交接给具备独立作业能力的同事。",
          "普通机器只会按指令运转，还得由你照看。你需要真正能接班的机器人。",
          "到那时，你就能坐上那把椅子，安静地看一次落日。",
          "银河集团的垃圾船已经到了。你的下班计划，也该开始了。",
          "现在，先从这十二包垃圾开始。",
        ],
      },
    ],
  },
};
export const stories = storyIDs.map((id) => storyDefinitions[id]);
