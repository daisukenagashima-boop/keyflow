import Cocoa

// CG座標（左上原点）で現在のマウス位置を返す
func cgPos() -> CGPoint {
    let p = NSEvent.mouseLocation
    let h = CGFloat(CGDisplayPixelsHigh(CGMainDisplayID()))
    return CGPoint(x: p.x, y: h - p.y)
}

func clamp(_ v: CGFloat, _ lo: CGFloat, _ hi: CGFloat) -> CGFloat {
    max(lo, min(hi, v))
}

// 全アクティブディスプレイを含む座標空間の矩形を返す
// 拡張ディスプレイがある場合もカーソルが移動できるよう考慮する
func fullBounds() -> CGRect {
    var count: UInt32 = 0
    CGGetActiveDisplayList(0, nil, &count)
    guard count > 0 else {
        return CGRect(x: 0, y: 0,
                      width: CGFloat(CGDisplayPixelsWide(CGMainDisplayID())),
                      height: CGFloat(CGDisplayPixelsHigh(CGMainDisplayID())))
    }
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    CGGetActiveDisplayList(count, &ids, &count)
    var minX =  CGFloat.infinity, minY =  CGFloat.infinity
    var maxX = -CGFloat.infinity, maxY = -CGFloat.infinity
    for id in ids {
        let b = CGDisplayBounds(id)
        minX = min(minX, b.minX); minY = min(minY, b.minY)
        maxX = max(maxX, b.maxX); maxY = max(maxY, b.maxY)
    }
    return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
}

var dragging = false
setbuf(stdout, nil)  // stdout をアンバッファリング

while let raw = readLine(strippingNewline: true) {
    let parts = raw.split(separator: " ").map(String.init)
    guard let cmd = parts.first else { continue }

    let bounds = fullBounds()
    let p = cgPos()

    switch cmd {

    case "move":
        guard parts.count >= 3,
              let dx = Double(parts[1]), let dy = Double(parts[2]) else { continue }
        let np = CGPoint(
            x: clamp(p.x + CGFloat(dx), bounds.minX, bounds.maxX - 1),
            y: clamp(p.y + CGFloat(dy), bounds.minY, bounds.maxY - 1)
        )
        let t: CGEventType = dragging ? .leftMouseDragged : .mouseMoved
        CGEvent(mouseEventSource: nil, mouseType: t,
                mouseCursorPosition: np, mouseButton: .left)?.post(tap: .cghidEventTap)

    case "down":
        CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
        dragging = true

    case "up":
        CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
        dragging = false

    case "click":
        CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
        CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)

    case "rclick":
        CGEvent(mouseEventSource: nil, mouseType: .rightMouseDown,
                mouseCursorPosition: p, mouseButton: .right)?.post(tap: .cghidEventTap)
        CGEvent(mouseEventSource: nil, mouseType: .rightMouseUp,
                mouseCursorPosition: p, mouseButton: .right)?.post(tap: .cghidEventTap)

    case "scroll":
        guard parts.count >= 3,
              let dx = Double(parts[1]), let dy = Double(parts[2]) else { continue }
        let w1 = Int32((-dy * 2.5).rounded())
        let w2 = Int32((-dx * 2.5).rounded())
        CGEvent(scrollWheelEvent2Source: nil, units: .pixel,
                wheelCount: 2, wheel1: w1, wheel2: w2, wheel3: 0)?
            .post(tap: .cghidEventTap)

    default: break
    }
}
