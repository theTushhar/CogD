import fs from "node:fs";
import path from "node:path";

export class ReviewManager {
  constructor(reviewsDir) {
    this.reviewsDir = reviewsDir;
    fs.mkdirSync(reviewsDir, { recursive: true });
  }

  create(taskId, reviewer) {
    const review = {
      id: `review-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      taskId,
      reviewer,
      status: "pending",
      verdict: null,
      feedback: [],
      createdAt: new Date().toISOString()
    };
    this.#save(review);
    return review;
  }

  addFeedback(reviewId, file, line, comment, severity) {
    const review = this.get(reviewId);
    if (!review) return null;
    review.feedback.push({
      file,
      line,
      comment,
      severity: severity || "info",
      at: new Date().toISOString()
    });
    this.#save(review);
    return review;
  }

  submit(reviewId, verdict) {
    const review = this.get(reviewId);
    if (!review) return null;
    review.verdict = verdict;
    review.status = "completed";
    review.completedAt = new Date().toISOString();
    this.#save(review);
    return review;
  }

  get(reviewId) {
    const filePath = path.join(this.reviewsDir, `${reviewId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  list(status) {
    let files;
    try {
      files = fs.readdirSync(this.reviewsDir);
    } catch {
      return [];
    }
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.reviewsDir, f), "utf8"));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((r) => !status || r.status === status);
  }

  #save(review) {
    const filePath = path.join(this.reviewsDir, `${review.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(review, null, 2) + "\n");
  }
}
