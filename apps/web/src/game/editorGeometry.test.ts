import { describe, expect, it } from "vitest";
import {
  cellAtPoint,
  centeredCamera,
  nextRotation,
  placementIssue,
  zoomAt,
} from "./editorGeometry";
import type { FactoryDetail } from "../api/client";
describe("editor grid geometry", () => {
  it("keeps the world coordinate under the pointer fixed while zooming", () => {
    const camera = { x: -160, y: 70, zoom: 1.25 };
    const next = zoomAt(camera, 315, 270, 2);
    expect((315 - next.x) / next.zoom).toBeCloseTo(
      (315 - camera.x) / camera.zoom,
    );
    expect((270 - next.y) / next.zoom).toBeCloseTo(
      (270 - camera.y) / camera.zoom,
    );
    expect(zoomAt(camera, 100, 100, 50).zoom).toBe(3);
    expect(zoomAt(camera, 100, 100, 0.01).zoom).toBe(0.5);
  });
  it("fits and centers the entire board within the viewport", () => {
    const camera = centeredCamera(700, 550, 21, 21, true);
    expect(camera.x).toBeGreaterThanOrEqual(16);
    expect(camera.y).toBeGreaterThanOrEqual(16);
    expect(camera.x + 657 * camera.zoom).toBeLessThanOrEqual(684);
    expect(camera.y + 657 * camera.zoom).toBeLessThanOrEqual(534);
  });
  it("maps screen coordinates to an upward Y axis and rejects boundary overflow", () => {
    expect(cellAtPoint(100, 100, 30, 21, 21, 115, 115)).toEqual({
      x: -10,
      y: 10,
    });
    expect(cellAtPoint(100, 100, 30, 21, 21, 415, 415)).toEqual({ x: 0, y: 0 });
    expect(cellAtPoint(100, 100, 30, 21, 21, 729, 729)).toEqual({
      x: 10,
      y: -10,
    });
    expect(cellAtPoint(100, 100, 30, 21, 21, 730, 300)).toBeNull();
    expect(cellAtPoint(100, 100, 30, 21, 21, 99, 300)).toBeNull();
  });
  it("allows moving onto the same tile while rejecting other occupancy", () => {
    const factory = {
      width: 21,
      height: 21,
      buildings: [{ id: "one", x: 1, y: 1 }],
    } as FactoryDetail;
    expect(placementIssue(factory, { x: 1, y: 1 }, "one")).toBeNull();
    expect(placementIssue(factory, { x: 1, y: 1 })).toBe("目标格子已被占用");
    expect(placementIssue(factory, { x: 11, y: 1 })).toBe("坐标超出工厂边界");
  });
  it("wraps four quarter turns back to the original direction", () => {
    expect([
      nextRotation(0),
      nextRotation(90),
      nextRotation(180),
      nextRotation(270),
    ]).toEqual([90, 180, 270, 0]);
  });
});
