import { memo, type CSSProperties } from "react";
import { itemSpriteColor, itemSpriteURL } from "./itemSprites";
import "./ItemSprite.css";

function ItemSprite({ id }: { id: string }) {
  const src = itemSpriteURL(id);
  if (!src) return null;
  return (
    <span
      className="item-sprite"
      data-item-id={id}
      aria-hidden="true"
      style={{ "--item-stage-color": itemSpriteColor(id) } as CSSProperties}
    >
      <img
        src={src}
        alt=""
        width={128}
        height={128}
        draggable={false}
        decoding="async"
      />
    </span>
  );
}

export default memo(ItemSprite);
